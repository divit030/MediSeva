# MediSeva — AI-Powered Prescription Assistant

MediSeva is an AI-powered web application designed to simplify prescription management. It uses a vision-language AI model to analyze uploaded prescription documents and extract medicine-related information into a structured format that users can review, edit, and save.

The goal of the Application is to reduce manual effort involved in organizing prescription information.

## Features

- **AI Prescription Analysis:** Upload prescription images or PDFs and extract medicine information using a local AI model.
- **Medicine and Schedule Management:** Review and manage saved medicine details and View medicine timings and organize saved information.
- **Review Before Saving:** The user can check and correct the  AI-extracted information before saving it.
- **Local AI Inference:** Run the AI model through Ollama instead of depending on a hosted AI inference API.

## Tech Stack

| Technology | Purpose |
|---|---|
| React | Frontend user interface |
| Vite | Frontend development and build tooling |
| JavaScript | Application logic |
| FastAPI | Backend API |
| Python | Backend implementation |
| SQLite | Local database |
| Ollama | Running the AI model locally |
| Qwen2.5-VL 3B (`qwen2.5vl:3b`) | Vision-language model for prescription analysis |
| JWT | Authentication tokens |
| PyMuPDF | PDF text extraction and document processing |



## Project Structure

```text
medimate/
├── .gitignore
├── README.md
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── ...
└── medimate/
    ├── package.json
    ├── index.html
    └── src/
        ├── App.jsx
        ├── components/
        └── pages/
```





