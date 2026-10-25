
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  Upload,
  Pill,
  CalendarCheck,
  FileText,
  RefreshCw,
  Info,
} from "lucide-react";

const API_URL = "http://127.0.0.1:8000";
const TOKEN_KEY = "medimate_access_token";

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

export default function Dashboard() {
  const navigate = useNavigate();

  const [prescriptions, setPrescriptions] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const headers = getAuthHeaders();

      const response = await fetch(`${API_URL}/api/prescriptions`, {
        headers,
      });

      const data = await readResponse(response);

      const savedPrescriptions = Array.isArray(data)
        ? data
        : Array.isArray(data.prescriptions)
          ? data.prescriptions
          : [];

      const prescriptionDetails = await Promise.all(
        savedPrescriptions.map(async (prescription) => {
          const id = prescription.id ?? prescription.prescription_id;

          if (id == null) {
            return { prescription, medicines: [] };
          }

          const detailResponse = await fetch(
            `${API_URL}/api/prescriptions/${encodeURIComponent(id)}`,
            { headers }
          );

          const detail = await readResponse(detailResponse);

          return {
            prescription,
            medicines: Array.isArray(detail.medicines)
              ? detail.medicines
              : [],
          };
        })
      );

      const allMedicines = prescriptionDetails.flatMap(
        ({ prescription, medicines: savedMedicines }) =>
          savedMedicines
            .filter((medicine) => medicine.is_active !== 0)
            .map((medicine, index) => {
              const name =
                medicine.name ||
                medicine.medicine_name ||
                medicine.drug_name ||
                "Unnamed medicine";

              const timing = String(
                medicine.timing || medicine.frequency || ""
              ).trim();

              return {
                ...medicine,
                id: `${prescription.id ?? prescription.prescription_id}-${medicine.id ?? index}`,
                name,
                timing,
                dosage: medicine.dosage || medicine.dose || "",
                duration: medicine.duration || "",
                quantity: medicine.quantity || "",
                notes: medicine.notes || medicine.instructions || "",
                prescriptionFilename: prescription.filename || "",
                prescriptionId:
                  prescription.id ?? prescription.prescription_id,
              };
            })
      );

      setPrescriptions(savedPrescriptions);
      setMedicines(allMedicines);
      setSchedule(allMedicines.filter((medicine) => medicine.timing));
    } catch (err) {
      setError(
        err.message ||
          "Unable to connect to MediSeva. Check that your backend is running."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <div className="page-content">
      <section className="welcome-section">
        <div>
          <p className="eyebrow">YOUR PERSONAL HEALTH SPACE</p>
          <h1>
            Your health, <span>in good hands.</span>
          </h1>
          <p className="welcome-description">
            Keep your prescriptions organized and your medicine routine easier
            to manage.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={() => navigate("/prescriptions")}
          type="button"
        >
          <Upload size={18} />
          Upload prescription
        </button>
      </section>

      {error && (
        <div className="privacy-note" role="alert">
          <Info size={20} />
          <div>
            <strong>Dashboard data could not be loaded.</strong>
            <p>{error}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={loadDashboard}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      <section className="summary-grid">
        <article className="summary-card">
          <div className="summary-top">
            <span className="summary-icon purple">
              <Pill size={21} />
            </span>
            <ArrowUpRight size={19} className="muted-icon" />
          </div>
          <p className="summary-label">My medicines</p>
          <h2>
            {loading ? "—" : medicines.length} <span>saved</span>
          </h2>
          <p className="summary-note">
            {loading
              ? "Loading medicines..."
              : medicines.length === 0
                ? "No medicines added yet"
                : "From your confirmed prescriptions"}
          </p>
        </article>

        <article className="summary-card">
          <div className="summary-top">
            <span className="summary-icon green">
              <CalendarCheck size={21} />
            </span>
            <ArrowUpRight size={19} className="muted-icon" />
          </div>
          <p className="summary-label">Saved schedule entries</p>
          <h2>
            {loading ? "—" : schedule.length} <span>entries</span>
          </h2>
          <p className="summary-note">
            {loading
              ? "Loading schedule..."
              : schedule.length === 0
                ? "No timing instructions recorded"
                : "Medicines with recorded timing"}
          </p>
        </article>

        <article className="summary-card">
          <div className="summary-top">
            <span className="summary-icon orange">
              <FileText size={21} />
            </span>
            <ArrowUpRight size={19} className="muted-icon" />
          </div>
          <p className="summary-label">Prescriptions</p>
          <h2>
            {loading ? "—" : prescriptions.length} <span>saved</span>
          </h2>
          <p className="summary-note">
            {loading
              ? "Loading prescriptions..."
              : prescriptions.length === 0
                ? "Upload one to get started"
                : "Confirmed prescription records"}
          </p>
        </article>
      </section>

      <section className="dashboard-grid">
        <div className="content-panel">
          <div className="section-heading">
            <div>
              <h2>My medicines</h2>
              <p>Your confirmed medicine records</p>
            </div>
            <button
              className="text-button"
              onClick={() => navigate("/medicines")}
              type="button"
            >
              View all <ArrowRight size={16} />
            </button>
          </div>

          {loading ? (
            <div className="empty-state">
              <RefreshCw size={28} className="spin" />
              <p>Loading your medicines...</p>
            </div>
          ) : medicines.length > 0 ? (
            <div className="medicine-table">
              {medicines.slice(0, 4).map((medicine) => (
                <div className="medicine-row" key={medicine.id}>
                  <div className="medicine-icon">
                    <Pill size={21} />
                  </div>
                  <div className="medicine-row-info">
                    <strong>{medicine.name}</strong>
                    <span>
                      {[
                        medicine.dosage,
                        medicine.timing,
                        medicine.duration &&
                          `Duration: ${medicine.duration}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No additional details recorded"}
                    </span>
                  </div>
                  <span className="medicine-status status-active">
                    Confirmed
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Pill size={30} />
              <h3>No medicines yet</h3>
              <p>
                Upload a prescription and confirm the extracted information
                to see your medicines here.
              </p>
              <button
                className="secondary-button"
                onClick={() => navigate("/prescriptions")}
                type="button"
              >
                Upload prescription <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>

        <div className="content-panel schedule-panel">
          <div className="section-heading">
            <div>
              <h2>Saved schedule</h2>
              <p>Recorded timing instructions</p>
            </div>
            <button
              className="icon-button"
              aria-label="View schedule"
              onClick={() => navigate("/schedule")}
              type="button"
            >
              <ArrowUpRight size={18} />
            </button>
          </div>

          {loading ? (
            <div className="empty-state">
              <RefreshCw size={28} className="spin" />
              <p>Loading schedule...</p>
            </div>
          ) : schedule.length > 0 ? (
            <div className="schedule-list schedule-page-list">
              {schedule.slice(0, 4).map((item) => (
                <div className="schedule-item" key={item.id}>
                  <div className="timeline">
                    <span className="timeline-dot dot-purple" />
                  </div>
                  <div className="schedule-details">
                    <span className="schedule-time">{item.timing}</span>
                    <strong>{item.name}</strong>
                    {item.dosage && <p>Dosage: {item.dosage}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <CalendarCheck size={30} />
              <h3>Nothing scheduled yet</h3>
              <p>
                Timing instructions will appear here when they have been
                recorded and confirmed in your saved medicine details.
              </p>
            </div>
          )}

          <button
            className="secondary-button full-width"
            onClick={() => navigate("/schedule")}
            type="button"
          >
            Open full schedule <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <div className="dashboard-refresh">
        <button
          className="secondary-button"
          onClick={loadDashboard}
          disabled={loading}
          type="button"
        >
          <RefreshCw size={16} />
          Refresh dashboard
        </button>
      </div>
    </div>
  );
}
