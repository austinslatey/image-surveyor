# Waldoch Maybach Seat Color Survey

A local web survey for matching photos of Waldoch Maybach middle bucket seats to official Shop Seat colorways and part numbers.

A reviewer walks through each photo, picks the color the photo is showing, and submits a report. Driver-side (DS) and passenger-side (PS) SKUs that share a color are grouped, so one choice covers both part numbers.

## What you do in the survey

1. Enter your name.
2. For each photo, choose the matching color. Each option shows a body and piping swatch, a short color name, and the DS / PS part numbers from `Shop Seats - Add.csv`.
3. Add an optional note if the match is uncertain.
4. Review the photos grouped by color, then submit.

Two extra choices are always available:

- **Not sure / cannot determine** — lighting, crop, or quality is not enough to match a colorway.
- **None of these colors** — the photo does not match any Shop Seat color in the CSV.

Progress is stored in the browser, so a partially finished survey can be resumed on the same machine.

Keyboard shortcuts while matching photos:

- `1`–`8` select the official colorways (not the two extra choices).
- Left arrow goes back to the previous photo.
- Escape closes an enlarged photo.

## Where the photos come from

The survey shows two sets of images, local files first:

- JPEG, PNG, and WebP files in this folder and its subfolders (for example `black-pewter.JPG` and `sofas/quicksilver.JPG`). Files inside `survey-results/` are skipped.
- Every URL listed in `potential-usable-files.txt`. A line can be a bare URL or a short note followed by a URL; the note becomes the photo’s label.

## Where the colors come from

`Shop Seats - Add.csv` is the color catalog. Each row is a shop seat SKU (`Name`) and a display name. The server groups rows that share the same `COLOR:` text, keeps the DS and PS SKUs together, and builds the labels shown in the survey (body, piping, and inserts).

`Premier-Seats.csv` is a separate inventory export and is not loaded by the survey.

## How to run it

Python 3 is the only requirement. From this folder:

```bash
python server.py
```

On macOS or Linux you can also run `./start-survey.sh`.

The server listens on `http://127.0.0.1:8765/` and opens that page in your browser. Set `SURVEY_PORT` to use a different port.

Opening `index.html` directly will not work. The page needs the local server so it can read the CSV, the photo list, and the image files.

## What happens when you submit

Submitting builds a report addressed to `aslater@waldoch.com` and tries three ways to deliver it:

1. The local server writes a timestamped `.json` and `.csv` into `survey-results/`, then tries `mail` or `sendmail` if either is installed.
2. The page posts the same report through FormSubmit.
3. The page opens your email client with the report filled in, and downloads a CSV copy.

The CSV columns are photo number, image label, source (`local` or `url`), path or URL, chosen color, DS SKU, PS SKU, part-number label, and notes.

The email is a readable summary: photos grouped by color and part number, any photos still unanswered, then a flat list of every image.
