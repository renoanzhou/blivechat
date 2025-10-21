# -*- coding: utf-8 -*-
"""Study room state management."""
from __future__ import annotations

import asyncio
import dataclasses
import logging
import random
import time
import unicodedata
from collections import deque
from typing import Deque, Dict, List, Optional, Tuple, TYPE_CHECKING

import sqlalchemy

import config
import models.database
import models.study_room

if TYPE_CHECKING:
    from services.chat import RoomKey, RoomKeyType
else:
    RoomKey = object  # type: ignore[assignment]
    RoomKeyType = object  # type: ignore[assignment]

SEAT_ROWS = 4
SEAT_COLS = 5
INACTIVITY_SWEEP_INTERVAL = 60  # seconds
SYSTEM_MESSAGE_LIMIT = 50
EVENT_HISTORY_LIMIT = 50
MESSAGE_HISTORY_LIMIT = 128
ROOM_GC_TIMEOUT_MS = 6 * 60 * 60 * 1000  # 6 hours


@dataclasses.dataclass
class Seat:
    id: str
    label: str
    row: int
    col: int


@dataclasses.dataclass
class SystemMessage:
    message: str
    timestamp_ms: int


@dataclasses.dataclass
class WaitlistEntry:
    user_key: str
    username: str
    requested_ms: int


@dataclasses.dataclass
class RoomEvent:
    type: str
    username: str
    user_id: Optional[str]
    message: str
    timestamp_ms: int
    seat_label: Optional[str] = None
    reason: Optional[str] = None


@dataclasses.dataclass
class UserState:
    user_key: str
    user_id: str
    display_name: str
    seat_id: Optional[str] = None
    status: str = "idle"
    last_active_ms: int = 0
    total_study_ms: int = 0
    study_started_at_ms: Optional[int] = None
    message_timestamps: Deque[int] = dataclasses.field(
        default_factory=lambda: deque(maxlen=MESSAGE_HISTORY_LIMIT)
    )
    last_leave_reason: Optional[str] = None
    is_active: bool = False


@dataclasses.dataclass
class RoomState:
    room_key: RoomKey
    seats: List[Seat]
    seat_lookup: Dict[str, Seat]
    seat_assignments: Dict[str, str] = dataclasses.field(default_factory=dict)
    users: Dict[str, UserState] = dataclasses.field(default_factory=dict)
    system_messages: Deque[SystemMessage] = dataclasses.field(
        default_factory=lambda: deque(maxlen=SYSTEM_MESSAGE_LIMIT)
    )
    waitlist: Deque[WaitlistEntry] = dataclasses.field(default_factory=deque)
    events: Deque[RoomEvent] = dataclasses.field(default_factory=lambda: deque(maxlen=EVENT_HISTORY_LIMIT))
    last_update_ms: int = 0


logger = logging.getLogger(__name__)


def _current_millis() -> int:
    return int(time.time() * 1000)


def _canonical_text(value: str) -> str:
    chars: List[str] = []
    for ch in value:
        if ch.isspace():
            continue
        category = unicodedata.category(ch)
        if category.startswith('P') or category.startswith('S'):
            continue
        chars.append(ch.lower())
    return ''.join(chars)


def _strip_command_prefix(text: str, prefixes: Tuple[str, ...]) -> Tuple[str, bool]:
    remainder = text.lstrip(':：').lstrip()
    used_prefix = False
    while True:
        matched = False
        for prefix in prefixes:
            if prefix and remainder.startswith(prefix):
                used_prefix = True
                remainder = remainder[len(prefix):].lstrip()
                matched = True
                break
        if not matched:
            break
    return remainder, used_prefix


def _normalize_command_text(text: str) -> str:
    stripped = text.strip()
    stripped = stripped.strip('!！?？。.;；~～-———*_＋+、,，')
    return stripped


def _touch_room(state: RoomState, now_ms: int) -> None:
    state.last_update_ms = now_ms


class StudyRoomManager:
    """Keep track of study room occupancy, waitlists, and learning metrics."""

    def __init__(self) -> None:
        self._states: Dict[RoomKey, RoomState] = {}
        self._lock = asyncio.Lock()
        self._sweep_task: Optional[asyncio.Task] = None
        self._alias_cache_key: Optional[Tuple] = None
        self._alias_cache: Optional[Dict[str, object]] = None

    def start(self) -> None:
        if self._sweep_task is not None:
            return
        loop = asyncio.get_event_loop()
        self._sweep_task = loop.create_task(self._inactivity_loop(), name="study-room-inactivity-loop")

    async def stop(self) -> None:
        if self._sweep_task is not None:
            self._sweep_task.cancel()
            try:
                await self._sweep_task
            except asyncio.CancelledError:
                pass
            self._sweep_task = None
        async with self._lock:
            self._states.clear()

    async def process_text(
        self,
        room_key: RoomKey,
        username: str,
        text: str,
        *,
        user_id: Optional[str] = None,
        timestamp_ms: Optional[int] = None,
    ) -> None:
        username = username.strip()
        if not username:
            return
        if text is None:
            return
        normalized = text.strip()
        if not normalized:
            return

        now_ms = timestamp_ms if timestamp_ms is not None else _current_millis()
        user_key = str(user_id).strip() if user_id else username
        cfg = config.get_config()
        alias_cfg = self._get_alias_cache()

        async with self._lock:
            state = self._ensure_room_state(room_key, now_ms)
            user_state = self._ensure_user_state(state, user_key, username, user_id, now_ms)
            command, _ = self._classify_command(normalized, alias_cfg)

            logger.info(
                "study_room.process_text room=%s user=%s uid=%s text=%s status=%s seat=%s",
                room_key,
                username,
                user_state.user_id,
                normalized,
                user_state.status,
                user_state.seat_id,
            )

            self._register_activity(user_state, now_ms, cfg)

            if command == 'join':
                self._remove_from_waitlist(state, user_state.user_key)
                self._handle_join(state, room_key, user_state, username, now_ms)
            elif command == 'leave':
                self._remove_from_waitlist(state, user_state.user_key)
                self._handle_leave(state, room_key, user_state, username, "离开图书馆", now_ms, event_type='leave')
            elif command == 'study':
                self._set_status(state, room_key, user_state, 'study', now_ms)
                seat_label = self._seat_label(state, user_state.seat_id)
                message = f"系统：{username} 正在努力学习。"
                self._push_message(state, message, now_ms)
                self._record_event(state, 'study', username, user_state.user_id, now_ms, seat_label=seat_label, message=message)
            elif command == 'rest':
                self._set_status(state, room_key, user_state, 'rest', now_ms)
                seat_label = self._seat_label(state, user_state.seat_id)
                message = f"系统：{username} 去休息了。"
                self._push_message(state, message, now_ms)
                self._record_event(state, 'rest', username, user_state.user_id, now_ms, seat_label=seat_label, message=message)
            else:
                self._push_message(state, f"弹幕：{username} 说「{normalized}」", now_ms)

    async def get_state(self, room_key: RoomKey) -> dict:
        now_ms = _current_millis()
        async with self._lock:
            state = self._ensure_room_state(room_key, now_ms)
            return self._serialize_state(state)

    async def inject_mock_message(
        self,
        room_key: RoomKey,
        username: str,
        text: str,
        *,
        user_id: Optional[str] = None,
    ) -> None:
        await self.process_text(room_key, username, text, user_id=user_id)

    async def remove_room(self, room_key: RoomKey) -> None:
        async with self._lock:
            state = self._states.get(room_key)
            if state is None:
                return
            now_ms = _current_millis()
            _touch_room(state, now_ms)
            logger.info("study_room.room_marked_inactive room=%s", room_key)
            self._gc_rooms(now_ms)

    def make_room_key(self, room_key_type: int, room_key_value: str) -> "RoomKey":
        from services.chat import RoomKey, RoomKeyType as _RoomKeyType

        key_type = _RoomKeyType(room_key_type)
        if key_type == _RoomKeyType.ROOM_ID:
            try:
                value = int(room_key_value)
            except (TypeError, ValueError) as exc:
                raise ValueError("Invalid roomKeyValue for ROOM_ID") from exc
        else:
            value = room_key_value
        return RoomKey(type=key_type, value=value)

    async def _inactivity_loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(INACTIVITY_SWEEP_INTERVAL)
                await self._mark_inactive_users()
        except asyncio.CancelledError:
            return

    async def _mark_inactive_users(self) -> None:
        cfg = config.get_config()
        timeout_ms = max(cfg.study_room_inactivity_timeout_ms, 60 * 1000)
        now_ms = _current_millis()
        async with self._lock:
            for state in self._states.values():
                for user_state in list(state.users.values()):
                    if user_state.seat_id is None:
                        continue
                    if user_state.status == 'away':
                        continue
                    if now_ms - user_state.last_active_ms < timeout_ms:
                        continue
                    reason = "长时间未互动，被自动移出座位"
                    self._handle_leave(
                        state,
                        state.room_key,
                        user_state,
                        user_state.display_name,
                        reason,
                        now_ms,
                        event_type='auto_leave',
                    )
            self._gc_rooms(now_ms)

    def _ensure_room_state(self, room_key: RoomKey, now_ms: int) -> RoomState:
        state = self._states.get(room_key)
        if state is None:
            seats, seat_lookup = self._build_seats()
            state = RoomState(room_key=room_key, seats=seats, seat_lookup=seat_lookup, last_update_ms=now_ms)
            self._states[room_key] = state
        else:
            _touch_room(state, now_ms)
        return state

    def _ensure_user_state(
        self,
        state: RoomState,
        user_key: str,
        username: str,
        user_id: Optional[str],
        now_ms: int,
    ) -> UserState:
        user_state = state.users.get(user_key)
        if user_state is None:
            stored_id = user_id or user_key
            user_state = UserState(
                user_key=user_key,
                user_id=stored_id,
                display_name=username,
                last_active_ms=now_ms,
            )
            state.users[user_key] = user_state
        else:
            user_state.display_name = username
            if user_id and user_state.user_id != user_id:
                user_state.user_id = user_id
        return user_state

    def _build_seats(self) -> Tuple[List[Seat], Dict[str, Seat]]:
        seats: List[Seat] = []
        seat_lookup: Dict[str, Seat] = {}
        for row in range(SEAT_ROWS):
            for col in range(SEAT_COLS):
                seat_id = f"seat-{row}-{col}"
                seat = Seat(id=seat_id, label=f"S{row + 1}-{col + 1}", row=row, col=col)
                seats.append(seat)
                seat_lookup[seat_id] = seat
        return seats, seat_lookup

    def _gc_rooms(self, now_ms: int) -> None:
        removable: List[RoomKey] = []
        for room_key, state in list(self._states.items()):
            if state.seat_assignments:
                continue
            if state.waitlist:
                continue
            if any(user.seat_id for user in state.users.values()):
                continue
            if now_ms - state.last_update_ms < ROOM_GC_TIMEOUT_MS:
                continue
            removable.append(room_key)
        for room_key in removable:
            self._states.pop(room_key, None)
            logger.info("study_room.gc room=%s removed stale state", room_key)

    def _classify_command(self, text: str, alias_cfg: Dict[str, object]) -> Tuple[Optional[str], bool]:
        remainder, used_prefix = _strip_command_prefix(text, alias_cfg['prefixes'])
        normalized = _normalize_command_text(remainder)
        canonical = _canonical_text(normalized)
        if not canonical:
            return None, used_prefix
        for name in ('join', 'leave', 'study', 'rest'):
            if canonical in alias_cfg[name]:
                return name, used_prefix
        return None, used_prefix

    def _register_activity(self, user_state: UserState, now_ms: int, cfg: config.AppConfig) -> None:
        user_state.last_active_ms = now_ms
        timestamps = user_state.message_timestamps
        timestamps.append(now_ms)
        window_ms = max(cfg.study_room_activity_window_ms, 60 * 1000)
        cutoff = now_ms - window_ms
        while timestamps and timestamps[0] < cutoff:
            timestamps.popleft()
        user_state.is_active = len(timestamps) >= cfg.study_room_activity_min_messages
        if user_state.is_active:
            user_state.last_leave_reason = None

    def _assign_seat(self, state: RoomState, user_state: UserState) -> Optional[Seat]:
        available = [seat for seat in state.seats if seat.id not in state.seat_assignments]
        if not available:
            return None
        seat = random.choice(available)
        state.seat_assignments[seat.id] = user_state.user_key
        user_state.seat_id = seat.id
        user_state.last_leave_reason = None
        return seat

    def _handle_join(self, state: RoomState, room_key: RoomKey, user_state: UserState, username: str, now_ms: int) -> None:
        _touch_room(state, now_ms)
        if user_state.seat_id:
            seat_label = self._seat_label(state, user_state.seat_id)
            message = (
                f"系统：{username} 已经在 {seat_label}，继续加油！"
                if seat_label
                else f"系统：{username} 已经在座位上。"
            )
            self._push_message(state, message, now_ms)
            self._record_event(state, 'join_confirm', username, user_state.user_id, now_ms, seat_label=seat_label, message=message)
            self._set_status(state, room_key, user_state, 'study', now_ms)
            return

        seat = self._assign_seat(state, user_state)
        if seat is not None:
            message = f"系统：{username} 加入了图书馆，坐在 {seat.label}。"
            logger.info("study_room.join_success room=%s user=%s seat=%s", state.room_key, username, seat.id)
            self._push_message(state, message, now_ms)
            self._record_event(state, 'join', username, user_state.user_id, now_ms, seat_label=seat.label, message=message)
            self._set_status(state, room_key, user_state, 'study', now_ms)
            return

        position = self._add_to_waitlist(state, user_state, username, now_ms)
        message = (
            f"系统：{username} 试图加入，但座位已满，已加入候补队列第 {position + 1} 位。"
            if position is not None
            else f"系统：{username} 试图加入，但座位已满。"
        )
        self._push_message(state, message, now_ms)
        self._record_event(state, 'waitlist', username, user_state.user_id, now_ms, message=message)
        user_state.status = 'idle'
        self._persist_learning_record(state, user_state, now_ms)

    def _add_to_waitlist(self, state: RoomState, user_state: UserState, username: str, now_ms: int) -> Optional[int]:
        for idx, entry in enumerate(state.waitlist):
            if entry.user_key == user_state.user_key:
                entry.username = username
                _touch_room(state, now_ms)
                return idx
        entry = WaitlistEntry(user_key=user_state.user_key, username=username, requested_ms=now_ms)
        state.waitlist.append(entry)
        _touch_room(state, now_ms)
        return len(state.waitlist) - 1

    def _remove_from_waitlist(self, state: RoomState, user_key: str) -> None:
        if not state.waitlist:
            return
        for entry in list(state.waitlist):
            if entry.user_key == user_key:
                state.waitlist.remove(entry)

    def _handle_leave(
        self,
        state: RoomState,
        room_key: RoomKey,
        user_state: UserState,
        username: str,
        reason: str,
        now_ms: int,
        *,
        event_type: str,
    ) -> None:
        _touch_room(state, now_ms)
        seat_label = self._seat_label(state, user_state.seat_id)
        if user_state.seat_id:
            state.seat_assignments.pop(user_state.seat_id, None)
            user_state.seat_id = None
        if user_state.status == 'study' and user_state.study_started_at_ms is not None:
            user_state.total_study_ms += max(0, now_ms - user_state.study_started_at_ms)
            user_state.study_started_at_ms = None
        user_state.status = 'away'
        user_state.last_active_ms = now_ms
        user_state.last_leave_reason = reason
        message = f"系统：{username} {reason}。"
        self._push_message(state, message, now_ms)
        self._record_event(state, event_type, username, user_state.user_id, now_ms, seat_label=seat_label, reason=reason, message=message)
        self._remove_from_waitlist(state, user_state.user_key)
        self._persist_learning_record(state, user_state, now_ms)
        self._promote_waitlist(state, room_key, now_ms)

    def _promote_waitlist(self, state: RoomState, room_key: RoomKey, now_ms: int) -> None:
        if not state.waitlist:
            return
        cfg = config.get_config()
        while state.waitlist:
            entry = state.waitlist.popleft()
            user_state = state.users.get(entry.user_key)
            if user_state is None or user_state.seat_id:
                continue
            seat = self._assign_seat(state, user_state)
            if seat is None:
                state.waitlist.appendleft(entry)
                return
            user_state.display_name = entry.username
            self._register_activity(user_state, now_ms, cfg)
            _touch_room(state, now_ms)
            message = f"系统：{entry.username} 从候补进入 {seat.label}。"
            self._push_message(state, message, now_ms)
            self._record_event(state, 'waitlist_promoted', entry.username, user_state.user_id, now_ms, seat_label=seat.label, message=message)
            self._set_status(state, room_key, user_state, 'study', now_ms)
            break

    def _set_status(self, state: RoomState, room_key: RoomKey, user_state: UserState, status: str, now_ms: int) -> None:
        _touch_room(state, now_ms)
        if user_state.status == status:
            if status == 'study' and user_state.study_started_at_ms is None:
                user_state.study_started_at_ms = now_ms
            self._persist_learning_record(state, user_state, now_ms)
            return
        if user_state.status == 'study' and user_state.study_started_at_ms is not None:
            user_state.total_study_ms += max(0, now_ms - user_state.study_started_at_ms)
            user_state.study_started_at_ms = None
        if status == 'study':
            user_state.study_started_at_ms = now_ms
        user_state.status = status
        if status != 'away':
            user_state.last_leave_reason = None
        self._persist_learning_record(state, user_state, now_ms)

    def _persist_learning_record(self, state: RoomState, user_state: UserState, now_ms: int) -> None:
        user_id = user_state.user_id or user_state.user_key
        if not user_id:
            return
        total_ms = self._current_total_study_ms(user_state, now_ms)
        session = models.database.get_session()
        try:
            stmt = sqlalchemy.select(models.study_room.StudyRoomSession).where(
                models.study_room.StudyRoomSession.room_key_type == int(state.room_key.type),
                models.study_room.StudyRoomSession.room_key_value == str(state.room_key.value),
                models.study_room.StudyRoomSession.user_id == user_id,
            )
            record = session.execute(stmt).scalar_one_or_none()
            if record is None:
                record = models.study_room.StudyRoomSession(
                    room_key_type=int(state.room_key.type),
                    room_key_value=str(state.room_key.value),
                    user_id=user_id,
                    username=user_state.display_name,
                )
                session.add(record)
            record.username = user_state.display_name
            record.total_study_ms = total_ms
            record.last_active_ms = user_state.last_active_ms
            record.last_status = user_state.status
            record.last_leave_reason = user_state.last_leave_reason or ''
            session.commit()
        except Exception:
            logger.exception(
                'Failed to persist study room session room=%s user=%s',
                state.room_key,
                user_state.display_name,
            )
            session.rollback()
        finally:
            session.close()

    @staticmethod
    def _current_total_study_ms(user_state: UserState, now_ms: int) -> int:
        total = user_state.total_study_ms
        if user_state.status == 'study' and user_state.study_started_at_ms is not None:
            total += max(0, now_ms - user_state.study_started_at_ms)
        return total

    def _record_event(
        self,
        state: RoomState,
        event_type: str,
        username: str,
        user_id: Optional[str],
        timestamp_ms: int,
        *,
        seat_label: Optional[str] = None,
        reason: Optional[str] = None,
        message: str = '',
    ) -> None:
        state.events.append(
            RoomEvent(
                type=event_type,
                username=username,
                user_id=user_id,
                message=message,
                timestamp_ms=timestamp_ms,
                seat_label=seat_label,
                reason=reason,
            )
        )
        _touch_room(state, timestamp_ms)

    @staticmethod
    def _seat_label(state: RoomState, seat_id: Optional[str]) -> Optional[str]:
        if seat_id is None:
            return None
        seat = state.seat_lookup.get(seat_id)
        return seat.label if seat else None

    def _push_message(self, state: RoomState, message: str, timestamp_ms: int) -> None:
        state.system_messages.append(SystemMessage(message=message, timestamp_ms=timestamp_ms))
        _touch_room(state, timestamp_ms)

    def _serialize_state(self, state: RoomState) -> dict:
        cfg = config.get_config()
        alias_cfg = self._get_alias_cache()
        now_ms = _current_millis()

        seats_payload: List[dict] = []
        available_count = 0
        for seat in state.seats:
            occupant_key = state.seat_assignments.get(seat.id)
            occupant_payload = None
            if occupant_key:
                user_state = state.users.get(occupant_key)
                if user_state:
                    total_ms = self._current_total_study_ms(user_state, now_ms)
                    occupant_payload = {
                        'name': user_state.display_name,
                        'userId': user_state.user_id,
                        'status': user_state.status,
                        'totalStudyMs': total_ms,
                        'lastActive': user_state.last_active_ms,
                        'isActive': user_state.is_active,
                    }
            if occupant_payload is None:
                available_count += 1
            seats_payload.append(
                {
                    'id': seat.id,
                    'label': seat.label,
                    'row': seat.row,
                    'col': seat.col,
                    'occupant': occupant_payload,
                }
            )

        leaderboard: List[dict] = []
        for user_state in state.users.values():
            total_ms = self._current_total_study_ms(user_state, now_ms)
            leaderboard.append(
                {
                    'name': user_state.display_name,
                    'userId': user_state.user_id,
                    'totalStudyMs': total_ms,
                    'status': user_state.status,
                }
            )
        leaderboard.sort(key=lambda entry: entry['totalStudyMs'], reverse=True)
        leaderboard = leaderboard[:10]

        system_messages = [
            {'message': msg.message, 'timestamp': msg.timestamp_ms}
            for msg in state.system_messages
        ]

        waitlist_payload = [
            {
                'name': entry.username,
                'position': index + 1,
                'requestedAt': entry.requested_ms,
            }
            for index, entry in enumerate(state.waitlist)
        ]

        events_payload = [
            {
                'type': event.type,
                'username': event.username,
                'userId': event.user_id,
                'message': event.message,
                'timestamp': event.timestamp_ms,
                'seatLabel': event.seat_label,
                'reason': event.reason,
            }
            for event in state.events
        ]

        primary_prefix = alias_cfg['prefixes'][0] if alias_cfg['prefixes'] else '/'
        primary_join_alias = alias_cfg['primary_join']
        join_prompt = {
            'availableSeatCount': available_count,
            'primaryCommand': f"{primary_prefix}{primary_join_alias}" if primary_join_alias else '',
            'prefixes': list(alias_cfg['prefixes']),
            'joinAliases': list(cfg.study_room_join_aliases),
            'leaveAliases': list(cfg.study_room_leave_aliases),
        }

        return {
            'timestamp': now_ms,
            'seats': seats_payload,
            'leaderboard': leaderboard,
            'systemMessages': system_messages,
            'availableSeatCount': available_count,
            'waitlist': waitlist_payload,
            'recentEvents': events_payload,
            'joinPrompt': join_prompt,
            'activityConfig': {
                'inactivityTimeoutMs': cfg.study_room_inactivity_timeout_ms,
                'activityWindowMs': cfg.study_room_activity_window_ms,
                'activityMinMessages': cfg.study_room_activity_min_messages,
            },
        }

    def _get_alias_cache(self) -> Dict[str, object]:
        cfg = config.get_config()
        key = (
            tuple(cfg.study_room_command_prefixes),
            tuple(cfg.study_room_join_aliases),
            tuple(cfg.study_room_leave_aliases),
            tuple(cfg.study_room_study_aliases),
            tuple(cfg.study_room_rest_aliases),
        )
        if key != self._alias_cache_key:
            def _build_map(values: List[str]) -> Dict[str, str]:
                mapping: Dict[str, str] = {}
                for alias in values:
                    canonical = _canonical_text(alias)
                    if canonical:
                        mapping[canonical] = alias
                return mapping

            self._alias_cache = {
                'prefixes': tuple(cfg.study_room_command_prefixes),
                'join': _build_map(cfg.study_room_join_aliases),
                'leave': _build_map(cfg.study_room_leave_aliases),
                'study': _build_map(cfg.study_room_study_aliases),
                'rest': _build_map(cfg.study_room_rest_aliases),
                'primary_join': cfg.study_room_join_aliases[0] if cfg.study_room_join_aliases else '',
            }
            self._alias_cache_key = key
        return self._alias_cache  # type: ignore[return-value]


_MANAGER = StudyRoomManager()


def init() -> None:
    _MANAGER.start()


async def shut_down() -> None:
    await _MANAGER.stop()


async def process_text(
    room_key: RoomKey,
    username: str,
    text: str,
    *,
    user_id: Optional[str] = None,
    timestamp_ms: Optional[int] = None,
) -> None:
    await _MANAGER.process_text(room_key, username, text, user_id=user_id, timestamp_ms=timestamp_ms)


async def get_state(room_key: RoomKey) -> dict:
    return await _MANAGER.get_state(room_key)


async def inject_mock_message(
    room_key: RoomKey,
    username: str,
    text: str,
    *,
    user_id: Optional[str] = None,
) -> None:
    await _MANAGER.inject_mock_message(room_key, username, text, user_id=user_id)


async def remove_room(room_key: RoomKey) -> None:
    await _MANAGER.remove_room(room_key)


def make_room_key(room_key_type: int, room_key_value: str) -> RoomKey:
    return _MANAGER.make_room_key(room_key_type, room_key_value)
