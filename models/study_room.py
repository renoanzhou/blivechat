# -*- coding: utf-8 -*-
from __future__ import annotations

import datetime

import sqlalchemy as sa

from . import database


class StudyRoomSession(database.OrmBase):
    __tablename__ = 'study_room_sessions'

    id = sa.Column(sa.Integer, primary_key=True, autoincrement=True)
    room_key_type = sa.Column(sa.Integer, nullable=False)
    room_key_value = sa.Column(sa.String(128), nullable=False)
    user_id = sa.Column(sa.String(128), nullable=False)
    username = sa.Column(sa.String(128), nullable=False)
    total_study_ms = sa.Column(sa.BigInteger, nullable=False, default=0)
    last_active_ms = sa.Column(sa.BigInteger, nullable=False, default=0)
    last_status = sa.Column(sa.String(32), nullable=False, default='idle')
    last_leave_reason = sa.Column(sa.String(255), nullable=False, default='')
    created_at = sa.Column(sa.DateTime, nullable=False, default=datetime.datetime.utcnow)
    updated_at = sa.Column(
        sa.DateTime,
        nullable=False,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
    )

    __table_args__ = (
        sa.UniqueConstraint(
            'room_key_type',
            'room_key_value',
            'user_id',
            name='uq_study_room_sessions_user',
        ),
    )
