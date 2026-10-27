-- Neal, 2026-10-27: "we now use a combination of dump trailers and dumpsters". New sales script
-- (10-27-26 Sales Presentation.docx) replaces the "we do not use dumpsters" paragraph on Slide 9.
-- Same wording as netlify/functions/_sales-script.js and public/sales-pitch/sales-script.pdf.
update training_days
   set script = replace(script::text,
         'Unlike other companies we do not use dumpsters. They can seriously damage your driveway. We only use dump trailers which roll in on tires and roll away on tires leaving no chance of damaging your driveway.',
         'Based on your location and house we will either order a dump trailer or a dumpster. What''s important to know in either case to make sure you pull your cars out of the garage so they don''t get blocked in.')::jsonb
 where script::text like '%Unlike other companies we do not use dumpsters.%';
