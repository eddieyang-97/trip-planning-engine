alter table trip_expense_events
  drop constraint trip_expense_events_currency_check,
  add constraint trip_expense_events_currency_code check (currency ~ '^[A-Z]{3}$');
