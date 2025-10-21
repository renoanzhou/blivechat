# -*- coding: utf-8 -*-
from typing import Optional

import config
import services.chat
import services.study_room

from . import base


def _parse_room_key(room_key_type_str: Optional[str], room_key_value: Optional[str]) -> services.chat.RoomKey:
    if room_key_type_str is None or room_key_value is None:
        raise ValueError('Missing roomKeyType or roomKeyValue')

    try:
        room_key_type = int(room_key_type_str)
    except ValueError as exc:
        raise ValueError('Invalid roomKeyType') from exc

    try:
        return services.study_room.make_room_key(room_key_type, str(room_key_value))
    except ValueError as exc:
        raise ValueError(str(exc)) from exc


class StudyRoomStateHandler(base.ApiHandler):
    async def get(self):
        try:
            room_key = _parse_room_key(
                self.get_query_argument('roomKeyType', None),
                self.get_query_argument('roomKeyValue', None),
            )
        except ValueError as exc:
            self.set_status(400)
            self.write({'error': str(exc)})
            return

        state = await services.study_room.get_state(room_key)
        self.write(state)


class StudyRoomMockMessageHandler(base.ApiHandler):
    async def post(self):
        cfg = config.get_config()
        if not cfg.debug:
            self.set_status(403)
            self.write({'error': 'Mock message endpoint is only available in debug mode'})
            return

        if not self.json_args:
            self.set_status(400)
            self.write({'error': 'Invalid JSON body'})
            return

        user = self.json_args.get('user', '').strip()
        text = self.json_args.get('text', '').strip()
        if not user or not text:
            self.set_status(400)
            self.write({'error': 'Missing user or text'})
            return

        try:
            room_key = _parse_room_key(
                str(self.json_args.get('roomKeyType', self.get_query_argument('roomKeyType', '1'))),
                self.json_args.get('roomKeyValue', self.get_query_argument('roomKeyValue', None)),
            )
        except ValueError as exc:
            self.set_status(400)
            self.write({'error': str(exc)})
            return

        await services.study_room.inject_mock_message(room_key, user, text)
        self.set_status(204)


ROUTES = [
    (r'/api/study_room/state', StudyRoomStateHandler),
    (r'/api/study_room/mock_message', StudyRoomMockMessageHandler),
]
