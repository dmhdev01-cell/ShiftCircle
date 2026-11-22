-- Release 5 #19: retire the 16 h shift template from new use.
-- Old databases keep their L16 history: rows are not deleted, and the board/roster/payroll
-- readers still join the template. New assignments and new open shifts must name an active
-- template; the API refuses L16 with a plain message, and the web pickers no longer offer it.
-- The rules keep L-01/S-03/U-03/U-04/U-05/U-11 and the extension tests: "16 h shift" in the
-- rules means a 12 h shift plus an extension, not this template.
UPDATE shift_template SET active = false WHERE code = 'L16';
