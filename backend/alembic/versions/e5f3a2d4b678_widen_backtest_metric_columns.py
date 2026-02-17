"""widen backtest metric columns

Revision ID: e5f3a2d4b678
Revises: d4e2b1c3f567
Create Date: 2026-02-17 18:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f3a2d4b678'
down_revision: Union[str, None] = 'd4e2b1c3f567'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('backtests', 'total_return', type_=sa.Numeric(20, 4))
    op.alter_column('backtests', 'cagr', type_=sa.Numeric(20, 4))
    op.alter_column('backtests', 'sharpe_ratio', type_=sa.Numeric(20, 4))
    op.alter_column('backtests', 'sortino_ratio', type_=sa.Numeric(20, 4))
    op.alter_column('backtests', 'max_drawdown', type_=sa.Numeric(20, 4))
    op.alter_column('backtests', 'win_rate', type_=sa.Numeric(20, 4))
    op.alter_column('backtests', 'profit_factor', type_=sa.Numeric(20, 4))


def downgrade() -> None:
    op.alter_column('backtests', 'total_return', type_=sa.Numeric(10, 4))
    op.alter_column('backtests', 'cagr', type_=sa.Numeric(10, 4))
    op.alter_column('backtests', 'sharpe_ratio', type_=sa.Numeric(10, 4))
    op.alter_column('backtests', 'sortino_ratio', type_=sa.Numeric(10, 4))
    op.alter_column('backtests', 'max_drawdown', type_=sa.Numeric(10, 4))
    op.alter_column('backtests', 'win_rate', type_=sa.Numeric(10, 4))
    op.alter_column('backtests', 'profit_factor', type_=sa.Numeric(10, 4))
