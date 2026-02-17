"""add notification_settings table

Revision ID: a8579cf8b937
Revises: bed3dc5662dc
Create Date: 2026-02-17 08:10:18.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a8579cf8b937'
down_revision: Union[str, None] = 'bed3dc5662dc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'notification_settings',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('telegram_enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('telegram_bot_token_enc', sa.Text(), nullable=True),
        sa.Column('telegram_chat_id', sa.String(length=100), nullable=True),
        sa.Column('email_enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('smtp_host', sa.String(length=255), nullable=True),
        sa.Column('smtp_port', sa.Integer(), nullable=True),
        sa.Column('smtp_username', sa.String(length=255), nullable=True),
        sa.Column('smtp_password_enc', sa.Text(), nullable=True),
        sa.Column('smtp_use_tls', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('email_from', sa.String(length=255), nullable=True),
        sa.Column('email_to', sa.String(length=255), nullable=True),
        sa.Column('sms_enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('twilio_account_sid', sa.String(length=100), nullable=True),
        sa.Column('twilio_auth_token_enc', sa.Text(), nullable=True),
        sa.Column('twilio_from_number', sa.String(length=20), nullable=True),
        sa.Column('sms_to_number', sa.String(length=20), nullable=True),
        sa.Column('event_channels', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', name='uq_notification_settings_user'),
    )


def downgrade() -> None:
    op.drop_table('notification_settings')
