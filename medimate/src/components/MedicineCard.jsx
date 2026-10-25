import { Pill, Clock, CheckCircle2 } from "lucide-react";

export default function MedicineCard({ medicine }) {
  return (
    <article className="medicine-card">
      <div className="medicine-card-top">
        <div className="medicine-icon">
          <Pill size={21} />
        </div>

        <span
          className={`medicine-status ${
            medicine.status === "Active" ? "status-active" : "status-completed"
          }`}
        >
          {medicine.status}
        </span>
      </div>

      <h3>{medicine.name}</h3>
      <p className="medicine-description">{medicine.description}</p>

      <div className="medicine-card-footer">
        <span>
          <Clock size={15} />
          {medicine.frequency}
        </span>
        {medicine.status === "Active" && (
          <CheckCircle2 size={17} className="success-icon" />
        )}
      </div>
    </article>
  );
}