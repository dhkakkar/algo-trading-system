"""add session_runs table and session_run_id to orders, trades, session_logs

Revision ID: f6a4b3c5d789
Revises: e5f3a2d4b678
Create Date: 2026-02-18 16:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f6a4b3c5d789'
down_revision: Union[str, None] = 'e5f3a2d4b678'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create session_runs table
    op.create_table(
        'session_runs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('trading_session_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('trading_sessions.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('run_number', sa.Integer, nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='running'),
        sa.Column('initial_capital', sa.Numeric(15, 2), nullable=False),
        sa.Column('final_capital', sa.Numeric(15, 2), nullable=True),
        sa.Column('total_return', sa.Numeric(20, 4), nullable=True),
        sa.Column('cagr', sa.Numeric(20, 4), nullable=True),
        sa.Column('sharpe_ratio', sa.Numeric(20, 4), nullable=True),
        sa.Column('sortino_ratio', sa.Numeric(20, 4), nullable=True),
        sa.Column('max_drawdown', sa.Numeric(20, 4), nullable=True),
        sa.Column('win_rate', sa.Numeric(20, 4), nullable=True),
        sa.Column('profit_factor', sa.Numeric(20, 4), nullable=True),
        sa.Column('total_trades', sa.Integer, nullable=True),
        sa.Column('avg_trade_pnl', sa.Numeric(15, 2), nullable=True),
        sa.Column('equity_curve', postgresql.JSONB, nullable=True),
        sa.Column('drawdown_curve', postgresql.JSONB, nullable=True),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('stopped_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # 2. Add session_run_id to orders
    op.add_column('orders', sa.Column('session_run_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('ix_orders_session_run_id', 'orders', ['session_run_id'])
    op.create_foreign_key('fk_orders_session_run_id', 'orders', 'session_runs',
                          ['session_run_id'], ['id'], ondelete='SET NULL')

    # 3. Add session_run_id to trades
    op.add_column('trades', sa.Column('session_run_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('ix_trades_session_run_id', 'trades', ['session_run_id'])
    op.create_foreign_key('fk_trades_session_run_id', 'trades', 'session_runs',
                          ['session_run_id'], ['id'], ondelete='SET NULL')

    # 4. Add session_run_id to session_logs
    op.add_column('session_logs', sa.Column('session_run_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('ix_session_logs_session_run_id', 'session_logs', ['session_run_id'])
    op.create_foreign_key('fk_session_logs_session_run_id', 'session_logs', 'session_runs',
                          ['session_run_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_session_logs_session_run_id', 'session_logs', type_='foreignkey')
    op.drop_index('ix_session_logs_session_run_id', table_name='session_logs')
    op.drop_column('session_logs', 'session_run_id')

    op.drop_constraint('fk_trades_session_run_id', 'trades', type_='foreignkey')
    op.drop_index('ix_trades_session_run_id', table_name='trades')
    op.drop_column('trades', 'session_run_id')

    op.drop_constraint('fk_orders_session_run_id', 'orders', type_='foreignkey')
    op.drop_index('ix_orders_session_run_id', table_name='orders')
    op.drop_column('orders', 'session_run_id')

    op.drop_table('session_runs')
