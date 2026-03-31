"""SMTP email sender."""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage

from . import config

logger = logging.getLogger(__name__)


async def send_email(to_email: str, subject: str, body: str) -> None:
    cfg = config.get()
    if cfg.email_debug:
        logger.info("Email debug enabled — to=%s subject=%s body=%s", to_email, subject, body)
    if not cfg.smtp_host or not cfg.smtp_from:
        raise RuntimeError("SMTP is not configured")

    msg = EmailMessage()
    msg["From"] = cfg.smtp_from
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    def _send() -> None:
        context = ssl.create_default_context()
        if cfg.smtp_ssl:
            server = smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=10, context=context)
        else:
            server = smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=10)
        with server as smtp:
            if cfg.smtp_starttls and not cfg.smtp_ssl:
                smtp.starttls(context=context)
            if cfg.smtp_user:
                smtp.login(cfg.smtp_user, cfg.smtp_password)
            smtp.send_message(msg)

    await asyncio.to_thread(_send)
