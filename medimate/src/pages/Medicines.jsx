
import {
  Pill,
  Search,
  Plus,
  Info,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

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
      result.detail || result.message || "The request could not be completed."
    );
  }

  return result;
}

export default function Medicines() {
  const [search, setSearch] = useState("");
  const [medicines, setMedicines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [medicinePendingRemoval, setMedicinePendingRemoval] = useState(null);
  const navigate = useNavigate();

  const loadMedicines = useCallback(async () => {
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
        : data.prescriptions || [];

      const results = await Promise.all(
        prescriptions.map(async (prescription) => {
          const id = prescription.id ?? prescription.prescription_id;

          if (id == null) return [];

          const detailResponse = await fetch(
            `${API_URL}/api/prescriptions/${encodeURIComponent(id)}`,
            { headers }
          );

          const details = await readResponse(detailResponse);
          const savedMedicines = Array.isArray(details.medicines)
            ? details.medicines
            : [];

          return savedMedicines
            .filter((medicine) => medicine.is_active !== 0)
            .map((medicine, index) => {
              const name =
                medicine.name ||
                medicine.medicine_name ||
                medicine.drug_name ||
                "Unnamed medicine";

              const dosage = medicine.dosage || medicine.dose || "";
              const quantity = medicine.quantity || "";
              const timing = medicine.timing || medicine.frequency || "";
              const duration = medicine.duration || "";
              const notes = medicine.notes || medicine.instructions || "";

              const detailParts = [
                dosage,
                quantity ? `Quantity: ${quantity}` : "",
                timing,
                duration ? `Duration: ${duration}` : "",
                notes,
              ].filter(Boolean);

              return {
                id: medicine.id,
                key: `${id}-${medicine.id ?? index}`,
                name,
                details:
                  detailParts.join(" · ") ||
                  "No additional details recorded",
                status: "Confirmed",
                prescriptionId: id,
              };
            });
        })
      );

      setMedicines(results.flat());
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
    loadMedicines();
  }, [loadMedicines]);

  const removeMedicine = async (medicine) => {
    if (medicine.id == null) {
      setDeleteError(
        "This medicine has no database ID and cannot be removed individually."
      );
      return;
    }

    setDeletingId(medicine.id);
    setDeleteError("");

    try {
      const response = await fetch(
        `${API_URL}/api/medicines/${encodeURIComponent(medicine.id)}`,
        {
          method: "DELETE",
          headers: getAuthHeaders(),
        }
      );

      await readResponse(response);

      setMedicines((current) =>
        current.filter((item) => item.id !== medicine.id)
      );
    } catch (err) {
      setDeleteError(
        err.message || "Unable to remove the medicine. Please try again."
      );
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return medicines;

    return medicines.filter((medicine) =>
      `${medicine.name} ${medicine.details}`.toLowerCase().includes(query)
    );
  }, [medicines, search]);

  return (
    <div className="page-content">
      <section className="page-heading">
        <p className="eyebrow">YOUR MEDICINE LIBRARY</p>
        <h1>My medicines</h1>
        <p>View and organize your confirmed medicine records.</p>
      </section>

      <section className="content-panel">
        <div className="medicines-toolbar">
          <label className="search-box medicine-search">
            <Search size={18} />
            <input
              placeholder="Search medicines..."
              aria-label="Search medicines"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <button
            className="primary-button"
            onClick={() => navigate("/prescriptions")}
          >
            <Plus size={18} />
            Upload prescription
          </button>
        </div>

        {deleteError && (
          <div className="empty-state" role="alert">
            <Info size={22} />
            <p>{deleteError}</p>
            <button
              className="secondary-button"
              onClick={() => setDeleteError("")}
            >
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div className="empty-state">
            <RefreshCw size={28} className="spin" />
            <h3>Loading your medicines...</h3>
          </div>
        ) : error ? (
          <div className="empty-state">
            <Info size={32} />
            <h3>Couldn't load medicines</h3>
            <p>{error}</p>
            <button className="secondary-button" onClick={loadMedicines}>
              Try again
            </button>
          </div>
        ) : (
          <div className="medicine-table">
            {filtered.map((medicine) => (
              <div className="medicine-row" key={medicine.key}>
                <div className="medicine-icon">
                  <Pill size={21} />
                </div>

                <div className="medicine-row-info">
                  <strong>{medicine.name}</strong>
                  <span>{medicine.details}</span>
                </div>

                <span className="medicine-status status-active">
                  {medicine.status}
                </span>

                <button
                  type="button"
                  className="medicine-delete-button"
                  onClick={() => setMedicinePendingRemoval(medicine)}
                  disabled={deletingId === medicine.id}
                  aria-label={`Remove ${medicine.name}`}
                  title={`Remove ${medicine.name}`}
                >
                  {deletingId === medicine.id ? (
                    <RefreshCw size={18} className="spin" />
                  ) : (
                    <Trash2 size={18} />
                  )}
                </button>
              </div>
            ))}

            {filtered.length === 0 && (
              <div className="empty-state">
                <Pill size={32} />
                <h3>
                  {search
                    ? "No matching medicines"
                    : "Your medicine list is empty"}
                </h3>
                <p>
                  {search
                    ? "Try another search term."
                    : "Once you upload a prescription and confirm its extracted details, your medicines will appear here."}
                </p>

                {!search && (
                  <button
                    className="secondary-button"
                    onClick={() => navigate("/prescriptions")}
                  >
                    Upload prescription
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="demo-notice">
          <Info size={17} />
          Only reviewed and confirmed medicine information is shown here.
        </div>
      </section>
      {medicinePendingRemoval && (
        <div className="medicine-confirm-overlay">
          <section
            className="medicine-confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="medicine-remove-title"
          >
            <h2 id="medicine-remove-title">Remove medicine?</h2>
            <p>
              Remove “{medicinePendingRemoval.name}” from your active medicine
              list? Your original prescription will be kept.
            </p>
            <div className="medicine-confirm-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setMedicinePendingRemoval(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const medicine = medicinePendingRemoval;
                  setMedicinePendingRemoval(null);
                  removeMedicine(medicine);
                }}
              >
                Remove medicine
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
