"""add session_logs table

Revision ID: c3f1a9b2d456
Revises: a8579cf8b937
Create Date: 2026-02-17 14:50:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c3f1a9b2d456'
down_revision: Union[str, None] = 'a8579cf8b937'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'session_logs',
        sa.Column('trading_session_id', sa.UUID(), nullable=False),
        sa.Column('level', sa.String(length=10), nullable=False, server_default='INFO'),
        sa.Column('source', sa.String(length=20), nullable=False, server_default='system'),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['trading_session_id'], ['trading_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_session_logs_session_id', 'session_logs', ['trading_session_id'])
    op.create_index('ix_session_logs_level', 'session_logs', ['level'])


def downgrade() -> None:
    op.drop_index('ix_session_logs_level', table_name='session_logs')
    op.drop_index('ix_session_logs_session_id', table_name='session_logs')
    op.drop_table('session_logs')
