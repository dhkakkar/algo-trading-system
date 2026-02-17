"""add logs column to backtests

Revision ID: d4e2b1c3f567
Revises: c3f1a9b2d456
Create Date: 2026-02-17 16:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd4e2b1c3f567'
down_revision: Union[str, None] = 'c3f1a9b2d456'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('backtests', sa.Column('logs', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('backtests', 'logs')
