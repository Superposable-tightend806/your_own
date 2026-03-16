"""add image_urls to messages

Revision ID: 0010
Revises: 0009
Create Date: 2026-03-17

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("image_urls", sa.ARRAY(sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "image_urls")
