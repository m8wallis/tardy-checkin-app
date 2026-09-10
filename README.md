# Kearny Tardy Check-In

A phone- and iPad-friendly site for the attendance desk. Scan a Kearny High School ID card, read the student name and ID number, stamp the time, mark tardy if they arrive after the bell, and export the log to CSV or Excel.

**Live site:** [https://m8wallis.github.io/tardy-checkin-app/](https://m8wallis.github.io/tardy-checkin-app/)

## How to use it

1. Open the live site on a phone or iPad, or open `index.html` on a computer.
2. Tap **Scan student ID** and line up the whole badge (name, `ID NUMBER`, and barcode). Or use **Upload or take photo**.
3. Check the name and ID, then save. The time and tardy flag are added automatically.
4. Export the day with **Export CSV** or **Export Excel**.

School start time defaults to **8:45 AM**. Change it under Settings. You can also add a grace period in minutes.

Add the page to an iPad Home Screen from Safari (**Share → Add to Home Screen**) so it opens like an app.

## What gets recorded

| Field | Source |
| --- | --- |
| Student name | Text on the white band of the badge |
| Student ID | `ID NUMBER` and/or the barcode |
| Timestamp | The moment you save the check-in |
| Tardy | Yes if that time is after start time + grace |

Records stay in this device’s browser only. Nothing is uploaded to a server.

## Opening it at school

Camera access needs `https` (or `localhost`). If the live camera is blocked, **Upload or take photo** still works, and so does **Type it in**.

The first scan downloads the text-reading library, so the iPad needs internet once. After that, check-ins work even if the connection is spotty.

## Local preview

```bash
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173).
