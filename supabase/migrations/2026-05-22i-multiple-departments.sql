-- Migration: convert department (single text) → departments (text[]).
--
-- Lets one person belong to multiple departments (e.g. "Sales, HR" for
-- someone wearing two hats). Existing single values become one-element
-- arrays. The visibility flag in directory_hidden ('department' key)
-- still hides the whole list — no change to that contract.

alter table trainees
  alter column department type text[]
  using (case
    when department is null or department = '' then null
    else array[department]
  end);

alter table trainees rename column department to departments;
