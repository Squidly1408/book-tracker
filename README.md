<p align="center"><img src="assets/banner.png" alt="Shelf" width="100%"></p>

<p align="center">![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white) ![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black) ![No build step](https://img.shields.io/badge/build-none-brightgreen) ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)</p>

Shelf keeps track of your whole library across three formats: physical books, ebooks and audiobooks. Log what you want to read, what you are reading and what you have finished, look books up automatically, and see your reading stats for the year.

<p align="center"><img src="assets/screenshot.png" alt="Shelf screenshot" width="85%"></p>

## Features

- Each book can be physical, ebook, audiobook or any mix
- Status (want / reading / finished / DNF), page or listening progress, star ratings, notes and dates
- Location and "lent to" fields for physical copies
- Search, filters, sorting, and grid or list views
- Open Library lookup by ISBN or title to fill in details and covers, with an offline fallback
- Stats: yearly reading goal and pace, books per month and year, format breakdown, total pages and hours
- JSON and CSV export and import (reads Goodreads-style CSVs), undo after delete, light and dark themes

## Getting started

No build step and no dependencies. Clone the repo and open `index.html`, or serve the folder locally:

```bash
git clone https://github.com/Squidly1408/book-tracker.git
cd book-tracker
python -m http.server 8765
```

Then visit http://localhost:8765.

## Project structure

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `app.js` | Library, lookup, stats, import and export |
| `styles.css` | Styles and themes |
| `assets/` | Logo and README images |

## Built with

HTML, CSS, JavaScript, localStorage, [Open Library API](https://openlibrary.org/developers/api)

## Limitations

- Data is stored in this browser only; use export and import to move it
- Covers are loaded from Open Library, so offline you see generated covers
- A book you both read and listened to counts towards both pages and hours

## License

Released under the [MIT License](LICENSE).
