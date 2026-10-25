
import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  Clock3,
  Info,
  Pill,
  RefreshCw,
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

export default function Schedule() {
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const headers = getAuthHeaders();

      const response = await fetch(`${API_URL}/api/prescriptions`, {
        headers,
      });

      const data = await readResponse(response);

      const prescriptions = Array.isArray(data)
        ? data
        : Array.isArray(data.prescriptions)
          ? data.prescriptions
          : [];

      const results = await Promise.all(
        prescriptions.map(async (prescription) => {
          const prescriptionId =
            prescription.id ?? prescription.prescription_id;

          if (prescriptionId == null) {
            return [];
          }

          const detailResponse = await fetch(
            `${API_URL}/api/prescriptions/${encodeURIComponent(
              prescriptionId
            )}`,
            { headers }
          );

          const detail = await readResponse(detailResponse);

          const medicines = Array.isArray(detail.medicines)
            ? detail.medicines
            : [];

          return medicines
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

              const instructions = [
                (medicine.dosage || medicine.dose) &&
                  `Dosage: ${medicine.dosage || medicine.dose}`,
                medicine.duration && `Duration: ${medicine.duration}`,
                medicine.quantity && `Quantity: ${medicine.quantity}`,
                (medicine.notes || medicine.instructions) &&
                  `Notes: ${medicine.notes || medicine.instructions}`,
              ]
                .filter(Boolean)
                .join(" · ");

              return {
                id: `${prescriptionId}-${medicine.id ?? index}`,
                time: timing,
                medicineName: name,
                instructions,
                prescriptionFilename: prescription.filename || "",
              };
            });
        })
      );

      const confirmedSchedule = results
        .flat()
        .filter((medicine) => medicine.time.length > 0);

      setSchedule(confirmedSchedule);
    } catch (err) {
      setError(
        err.message ||
          "Unable to connect to MediSeva. Check that the backend is running."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  return (
    <div className="page-content">
      <section className="page-heading">
        <p className="eyebrow">DAILY ROUTINE</p>
        <h1>Medicine schedule</h1>
        <p>
          Review timing instructions from your confirmed medicine records.
        </p>
      </section>

      <section className="content-panel">
        <div className="section-heading">
          <div>
            <h2>Confirmed instructions</h2>
            <p>
              <CalendarDays size={15} /> Saved prescription timings
            </p>
          </div>

          <button
            className="secondary-button"
            onClick={loadSchedule}
            disabled={loading}
            type="button"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="empty-state">
            <RefreshCw size={28} className="spin" />
            <p>Loading your confirmed medicine instructions...</p>
          </div>
        ) : error ? (
          <div className="empty-state" role="alert">
            <Info size={32} />
            <h3>Unable to load schedule</h3>
            <p>{error}</p>
            <button
              className="secondary-button"
              onClick={loadSchedule}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : schedule.length > 0 ? (
          <div className="schedule-list schedule-page-list">
            {schedule.map((item) => (
              <div className="schedule-item" key={item.id}>
                <div className="timeline">
                  <span className="timeline-dot dot-purple" />
                </div>

                <div className="schedule-details">
                  <span className="schedule-time">{item.time}</span>
                  <strong>{item.medicineName}</strong>
                  {item.instructions && <p>{item.instructions}</p>}
                  {item.prescriptionFilename && (
                    <p>Prescription: {item.prescriptionFilename}</p>
                  )}
                </div>

                <Clock3 size={19} className="muted-icon" />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Pill size={32} />
            <h3>No confirmed timing instructions</h3>
            <p>
              Your saved medicines will appear here when their confirmed
              records include timing instructions, such as "after breakfast"
              or "twice daily". MediSeva will not invent dose times when
              timing information is missing.
            </p>
          </div>
        )}

        <div className="privacy-note">
          <Info size={20} />
          <div>
            <strong>Your confirmed instructions come first.</strong>
            <p>
              This page displays saved timing instructions. It does not
              determine when you should take a medicine or replace your
              prescription.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
