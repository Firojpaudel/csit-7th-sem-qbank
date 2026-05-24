# B.Sc. CSIT 7th Semester Past Questions & Answers Workspace

This repository contains a responsive, high-fidelity past questions and answers dashboard designed for B.Sc. CSIT 7th Semester students. The application provides an interactive workspace for subjects including Advanced Java Programming, Data Warehousing and Data Mining, Principles of Management, and Software Project Management.

## System Architecture

The application is structured as a two-tier system with localized caching and external database synchronization:

### 1. Frontend Client
- **Structure**: Single-page application using raw semantic HTML5 and vanilla JavaScript (ES6+).
- **Styling**: Complete minimalist styling system inspired by Apple Human Interface Guidelines (HIG). Implements slate-dark and clean light theme variations, interactive widgets, progress trackers, and fluid glassmorphic drawers.
- **Dynamic Formatting**: Features automated client-side parsing of rich HTML layouts, block-code monospaced regions, bulleted lists, and pre-formatted terminal sequences.

### 2. Backend Server
- **Engine**: Node.js Express server acting as a synchronization bridge.
- **Database**: Integrated with a remote Neon PostgreSQL cluster for persistent, multi-device answer synchronization.
- **Authentication**: Stateless web token session architecture supporting signup, sign-in, and guest browsing modes.

---

## Question Database and Live Scraping

All past question banks have been extracted directly from live academic nodes using automated scrapers to ensure zero data loss.

### Scraped Question Metrics
- **Advanced Java Programming**: 96 Questions
- **Data Warehousing & Data Mining**: 83 Questions
- **Principles of Management**: 90 Questions
- **Software Project Management**: 48 Questions

### Asset Localization
- Image hotlinking constraints have been bypassed by programmatically fetching, downloading, and storing all high-resolution diagram resources inside the `assets/scraped/` directory.
- Carriage return carriage spacing gaps and duplicate newlines inside question codes have been cleaned and compressed to ensure compact code representation.

---

## Project Setup and Execution

To run this application locally, follow these steps:

### Prerequisites
- Node.js (v18 or higher recommended)
- PostgreSQL or a Neon Database connection string (specified in a `.env` file)

### Installation
1. Install the required Node dependencies:
   ```bash
   npm install
   ```

2. Configure your environment variable inside the `.env` file in the root directory:
   ```env
   PORT=3000
   DATABASE_URL=your_postgresql_connection_string
   ```

### Running the Application
1. Start the backend synchronization server:
   ```bash
   npm start
   ```

2. Open `index.html` directly in a browser or host it using a local development server (e.g., Live Server on port 5500).

## Repository Contents
- `index.html`: Main client landing page and layouts.
- `app.js`: Client-side logic, routing, AI prompts, and state management.
- `style.css`: HIG styling system, animations, variables, and responsive media blocks.
- `server.js`: Node.js Express server and PostgreSQL synchronization layer.
- `db.js`: Compiled client-side database module storing the 317 scraped past questions.
- `links.json`: Reference array mapping verified academic question bank paths.