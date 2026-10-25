
import { useRef, useState } from "react";
import {
  Upload,
  FileText,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import "./Prescriptions.css";

const API_URL = "http://127.0.0.1:8000";
const TOKEN_KEY = "medimate_access_token";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];

function getAuthHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);

  if (!token) {
    throw new Error("Your session has expired. Please log in again.");
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

async function readResponse(response) {
  const result = await response.json().catch(() => ({}));

  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.assign("/login");
    throw new Error("Your session has expired. Please log in again.");
  }

  if (!response.ok) {
    throw new Error(
      result.detail ||
        result.message ||
        "The request could not be completed."
    );
  }

  return result;
}

export default function Prescriptions() {
  const fileInputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savedPrescriptionId, setSavedPrescriptionId] = useState(null);
  const [showSavedCard, setShowSavedCard] = useState(false);

  function handleFileChange(event) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    const extension = selectedFile.name
      .slice(selectedFile.name.lastIndexOf("."))
      .toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setError("Please upload a PDF, JPG, JPEG, PNG, or WebP file.");
      event.target.value = "";
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setError("The file must be smaller than 10 MB.");
      event.target.value = "";
      return;
    }

    setFile(selectedFile);
    setAnalysis(null);
    setError("");
    setSuccess("");
    setSavedPrescriptionId(null);
  }

  function removeFile() {
    setFile(null);
    setAnalysis(null);
    setError("");
    setSuccess("");
    setSavedPrescriptionId(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function analyzePrescription() {
    if (!file || loading || saving) return;

    setLoading(true);
    setError("");
    setSuccess("");
    setAnalysis(null);
    setSavedPrescriptionId(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(
        `${API_URL}/api/prescriptions/analyze`,
        {
          method: "POST",
          headers: getAuthHeaders(),
          body: formData,
        }
      );

      const result = await readResponse(response);

      const medicines = Array.isArray(result.medicines)
        ? result.medicines
        : Array.isArray(result.analysis?.medicines)
          ? result.analysis.medicines
          : [];

      setAnalysis({
        analysis_id: result.analysis_id,
        filename: result.filename || file.name,
        medicines: medicines.map((medicine) => ({
          name: medicine.name || "",
          dosage: medicine.dosage || "",
          quantity: medicine.quantity || "",
          timing: medicine.timing || "",
          duration: medicine.duration || "",
          notes: medicine.notes || "",
          uncertainties: Array.isArray(medicine.uncertainties)
            ? medicine.uncertainties
            : [],
        })),
        document_uncertainties: Array.isArray(
          result.document_uncertainties
        )
          ? result.document_uncertainties
          : [],
      });

      if (medicines.length === 0) {
        setSuccess(
          "Analysis completed, but no medicines were identified. Verify the document before proceeding."
        );
      }
    } catch (err) {
      setError(
        err.message ||
          "Could not connect to the backend. Check that FastAPI is running."
      );
    } finally {
      setLoading(false);
    }
  }

  function updateMedicine(index, field, value) {
    setAnalysis((previous) => ({
      ...previous,
      medicines: previous.medicines.map((medicine, i) =>
        i === index ? { ...medicine, [field]: value } : medicine
      ),
    }));

    setSuccess("");
    setError("");
  }

  function removeMedicine(index) {
    setAnalysis((previous) => ({
      ...previous,
      medicines: previous.medicines.filter((_, i) => i !== index),
    }));

    setSuccess("");
    setError("");
  }

  async function confirmDetails() {
    if (!analysis || saving || savedPrescriptionId) return;

    if (analysis.medicines.length === 0) {
      setError("There are no medicine entries to save.");
      return;
    }

    if (analysis.medicines.some((medicine) => !medicine.name.trim())) {
      setError(
        "Every medicine needs a name. Fill in missing names or remove those entries."
      );
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `${API_URL}/api/prescriptions/confirm`,
        {
          method: "POST",
          headers: {
            ...getAuthHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            analysis_id: analysis.analysis_id,
            filename: analysis.filename,
            medicines: analysis.medicines.map((medicine) => ({
              name: medicine.name.trim(),
              dosage: medicine.dosage.trim(),
              quantity: medicine.quantity.trim(),
              timing: medicine.timing.trim(),
              duration: medicine.duration.trim(),
              notes: medicine.notes.trim(),
            })),
          }),
        }
      );

      const result = await readResponse(response);

      setSavedPrescriptionId(result.prescription_id);
      setShowSavedCard(true);
      setSuccess(
        `Prescription saved successfully. ${result.medicine_count ?? analysis.medicines.length} medicine record(s) stored in your database.`
      );
    } catch (err) {
      setError(
        err.message ||
          "Could not save the prescription. Check that the backend is running."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="prescriptions-page">
      <div className="prescriptions-container">
        <header className="prescriptions-header">
          <div className="header-icon">
            <FileText size={25} />
          </div>

          <div>
            <h1>Prescriptions</h1>
            <p>
              Turn your prescriptions into organized medicine records.
              Review every detail before saving.
            </p>
          </div>
        </header>

        <section className="prescription-upload-card">
          <div className="upload-icon">
            <Upload size={28} />
          </div>

          <h2>Upload your prescription</h2>

          <p className="upload-description">
            Choose a prescription to extract its medicine details.
          </p>

          <p className="upload-formats">
            PDF, JPG, PNG or WebP <span>·</span> Maximum 10 MB
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={handleFileChange}
            hidden
          />

          {!file ? (
            <button
              type="button"
              className="upload-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || saving}
            >
              <Upload size={18} />
              Choose prescription
            </button>
          ) : (
            <div className="selected-file">
              <div className="file-type-icon">
                <FileText size={22} />
              </div>

              <div className="selected-file-details">
                <strong title={file.name}>{file.name}</strong>
                <span>{(file.size / 1024).toFixed(1)} KB</span>
              </div>

              {!loading && !saving && !savedPrescriptionId && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove selected file"
                  onClick={removeFile}
                >
                  <X size={18} />
                </button>
              )}
            </div>
          )}

          {file && !savedPrescriptionId && (
            <button
              type="button"
              className="analyze-button"
              onClick={analyzePrescription}
              disabled={loading || saving}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Analyzing prescription...
                </>
              ) : (
                <>
                  <FileText size={18} />
                  Analyze prescription
                </>
              )}
            </button>
          )}

          <div className="privacy-note">
            <AlertCircle size={18} />
            <p>
              AI extraction may be incomplete or incorrect. Always verify
              every detail against the original document before saving.
            </p>
          </div>
        </section>

        {error && (
          <div className="error-message" role="alert">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="success-message" role="status">
            <CheckCircle2 size={20} />
            <span>{success}</span>
          </div>
        )}

        {analysis && (
          <section className="analysis-results">
            <div className="results-heading">
              <div>
                <span className="section-eyebrow">ANALYSIS RESULTS</span>
                <h2>Extracted details</h2>
                <p className="results-filename">
                  <FileText size={16} />
                  <span title={analysis.filename}>{analysis.filename}</span>
                </p>
              </div>

              <span
                className={`review-badge ${
                  savedPrescriptionId ? "saved-badge" : ""
                }`}
              >
                {savedPrescriptionId ? (
                  <CheckCircle2 size={15} />
                ) : (
                  <AlertCircle size={15} />
                )}
                {savedPrescriptionId ? "Saved" : "Review required"}
              </span>
            </div>

            {analysis.document_uncertainties.length > 0 && (
              <div className="uncertainty-notice">
                <AlertCircle size={21} />
                <div>
                  <strong>Document notes</strong>
                  <ul>
                    {analysis.document_uncertainties.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {analysis.medicines.length === 0 ? (
              <div className="empty-results">
                <div className="empty-results-icon">
                  <FileText size={27} />
                </div>
                <h3>No medicine entries identified</h3>
                <p>
                  The document may not contain a recognizable medicine
                  entry. Check the original document before proceeding.
                </p>
              </div>
            ) : (
              <div className="medicine-list">
                {analysis.medicines.map((medicine, index) => (
                  <article className="medicine-result-card" key={index}>
                    <div className="medicine-card-heading">
                      <div className="medicine-number">
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      <div>
                        <h3>Medicine details</h3>
                        <p>Review the extracted information below</p>
                      </div>
                    </div>

                    <div className="medicine-fields">
                      <label className="medicine-field">
                        <span>Medicine name</span>
                        <input
                          type="text"
                          value={medicine.name}
                          disabled={Boolean(savedPrescriptionId)}
                          onChange={(event) =>
                            updateMedicine(index, "name", event.target.value)
                          }
                          placeholder="Not identified"
                        />
                      </label>

                      <label className="medicine-field">
                        <span>Strength / dosage</span>
                        <input
                          type="text"
                          value={medicine.dosage}
                          disabled={Boolean(savedPrescriptionId)}
                          onChange={(event) =>
                            updateMedicine(index, "dosage", event.target.value)
                          }
                          placeholder="Not specified"
                        />
                      </label>

                      <label className="medicine-field">
                        <span>Quantity</span>
                        <input
                          type="text"
                          value={medicine.quantity}
                          disabled={Boolean(savedPrescriptionId)}
                          onChange={(event) =>
                            updateMedicine(index, "quantity", event.target.value)
                          }
                          placeholder="Not specified"
                        />
                      </label>

                      <label className="medicine-field">
                        <span>Timing instruction</span>
                        <input
                          type="text"
                          value={medicine.timing}
                          disabled={Boolean(savedPrescriptionId)}
                          onChange={(event) =>
                            updateMedicine(index, "timing", event.target.value)
                          }
                          placeholder="Not specified"
                        />
                      </label>

                      <label className="medicine-field">
                        <span>Duration</span>
                        <input
                          type="text"
                          value={medicine.duration}
                          disabled={Boolean(savedPrescriptionId)}
                          onChange={(event) =>
                            updateMedicine(index, "duration", event.target.value)
                          }
                          placeholder="Not specified"
                        />
                      </label>

                      <label className="medicine-field full-width">
                        <span>Additional instructions</span>
                        <textarea
                          rows={3}
                          value={medicine.notes}
                          disabled={Boolean(savedPrescriptionId)}
                          onChange={(event) =>
                            updateMedicine(index, "notes", event.target.value)
                          }
                          placeholder="No additional instructions identified"
                        />
                      </label>
                    </div>

                    {medicine.uncertainties.length > 0 && (
                      <div className="medicine-uncertainties">
                        <AlertCircle size={18} />
                        <div>
                          <strong>Please verify these details</strong>
                          <ul>
                            {medicine.uncertainties.map((note, noteIndex) => (
                              <li key={noteIndex}>{note}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}

                    {!savedPrescriptionId && (
                      <div className="medicine-card-actions">
                        <button
                          type="button"
                          className="remove-medicine-button"
                          onClick={() => removeMedicine(index)}
                        >
                          <X size={16} />
                          Remove medicine
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}

            {analysis.medicines.length > 0 && !savedPrescriptionId && (
              <div className="confirm-section">
                <div className="confirm-explanation">
                  <AlertCircle size={19} />
                  <p>
                    Check the extracted values against your original
                    prescription before saving.
                  </p>
                </div>

                <button
                  type="button"
                  className="confirm-button"
                  onClick={confirmDetails}
                  disabled={saving || loading}
                >
                  {saving ? (
                    <>
                      <Loader2 size={18} className="spin" />
                      Saving prescription...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={18} />
                      Confirm and save details
                    </>
                  )}
                </button>
              </div>
            )}

          </section>
        )}

        <footer className="prescriptions-footer">
          <span className="footer-brand">MediSeva</span>
          <span>·</span>
          Your health information, thoughtfully organized.
        </footer>
      </div>
      {showSavedCard && (
        <div className="prescription-success-overlay">
          <section
            className="prescription-success-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prescription-success-message"
          >
            <button
              type="button"
              className="prescription-success-close"
              onClick={() => setShowSavedCard(false)}
              aria-label="Close confirmation"
            >
              <X size={20} />
            </button>
            <span className="prescription-success-icon">
              <CheckCircle2 size={30} />
            </span>
            <p id="prescription-success-message">
              Your Prescription details are recorded
            </p>
            <button
              type="button"
              className="prescription-success-button"
              onClick={() => setShowSavedCard(false)}
            >
              Done
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
