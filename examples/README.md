# Local test fixtures

Open `form-fixture.html` directly in a browser or serve the repository with a local static server. It intentionally models common hiring-form obstacles:

- content hidden behind an Edit button;
- save/cancel interactions;
- native `<select>` controls with a value different from visible text;
- multiple sections and a textarea;
- no personal data or login state.

The saved BOSS page and its downloaded resources are kept only as local reference material. A saved authenticated page is not a reliable fixture: it depends on cookies, API responses, client-side routing, and private data. A `file://` copy can therefore redirect, render blank, or return to a homepage.

The fixture is intentionally separate from BOSS implementation and does not depend on cookies, API responses, private data, or production selectors.
