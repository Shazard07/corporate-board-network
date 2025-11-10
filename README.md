# Singapore Corporate Board Network Visualisation

This project is an interactive network visualisation of corporate board interlocks across major Singapore-based companies.  
It allows you to explore how directors are connected across companies, trace shared board memberships, and understand clusters of influence within Singapore’s corporate ecosystem.

The network is built using **vis.js** and rendered directly in the browser.  
You can navigate by **clicking nodes**, **switching explore modes**, or **searching by company or director name**.

---

## ✨ Features

- **Interactive Graph Navigation**
  - Click a **company** (square node) to reveal its board of directors.
  - Click a **director** (circle node) to reveal other companies they sit on.
  - Breadcrumb panel shows navigation history and allows step-back navigation.

- **Dual Exploration Modes**
  | Mode | Behaviour |
  |------|-----------|
  | **Visual Mode** (default) | Expands the network on click, showing connected nodes dynamically. |
  | **List Mode** | Reveals connections in a structured list without rearranging the graph visually. |

- **Search & Autocomplete**
  - Search by **director** or **company** name.
  - Highlights and focuses the selected node in the network.

- **Board Summary View**
  - Search for a company and view all of its directors at a glance.

- **Company List Panel**
  - Browse and click any company to jump directly to it.

- **Website Tooltip**
  - Hovering over a company node shows its official link (when available) with a **Copy URL** button.

---

## 🧱 Data

The dataset is stored in `data.js` as a flat list of nodes.  
Two node types are used:

| Shape | Meaning | Example |
|-------|---------|---------|
| `box` | Company | `Singtel`, `OCBC Ltd`, `ST Engineering` |
| `ellipse` | Director / Individual | Board members and associated executives |

**Current dataset counts:**  
- **Companies:** 67  
- **Directors:** 354 (based on dataset contents in `data.js`)

Connections between directors and companies are generated programmatically inside `app.js`.

---

## 🖥️ Running the Project

No build tools or backend are required.

### Option 1 — Open Directly
Just open `index.html` in your browser.

### Option 2 — Serve Locally (Recommended)
```bash
python3 -m http.server 8000
```
Open in browser:
```
http://localhost:8000
```

---

## 📂 File Structure

```
.
├─ index.html            # UI layout and structure
├─ style.css             # Front-end styling
├─ data.js               # Dataset of companies + directors
└─ app.js                # Network logic & interactions
```

---

## 🧭 How to Use

1. Click a **company node** to reveal its board.
2. Click a **director node** to reveal their other board memberships.
3. Use **Search** to jump to a specific person or company.
4. Switch between **Visual** and **List** exploration modes.
5. Press **Reset** to return to the starting view.

---

## ⚠️ Notes

- Directors with **only one company connection** are displayed in **grey**.
- Node layout is dynamic and may adjust as the graph expands.
- If the network fails to load, ensure `vis.js` is accessible online.

---

## 📜 License

This project is provided for research and educational use.  
Please credit the original creator when sharing or extending the work.
