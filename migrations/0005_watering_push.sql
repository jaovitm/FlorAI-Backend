-- Controle dos pushes de rega enviados pelo cron (evita repetir o mesmo aviso).
-- Lembrete no horário escolhido: ocorrência já avisada, no fuso do usuário (`yyyy-MM-ddTHH:mm`).
ALTER TABLE reminders ADD COLUMN scheduled_push_key TEXT;
-- Aviso diário (manhã/noite): turno já avisado, no fuso do usuário (`yyyy-MM-dd:morning|evening`).
ALTER TABLE reminders ADD COLUMN daily_push_key TEXT;
