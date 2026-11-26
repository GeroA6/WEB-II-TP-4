import { useState, type FormEvent } from "react";
import type { ProposalResultMessage } from "../../../shared/protocol";

interface ProposalFormProps {
  disabled: boolean;
  isProposing: boolean;
  lastResult: ProposalResultMessage | null;
  onPropose: (productIds: number[]) => void;
}

const REASON_LABELS: Record<string, string> = {
  not_found: "Inexistente",
  timeout: "Sin respuesta a tiempo (timeout)",
  already_exists: "Ya estaba en la lista",
  catalog_error: "Error del catálogo",
};

export function ProposalForm({
  disabled,
  isProposing,
  lastResult,
  onPropose,
}: ProposalFormProps) {
  const [rawIds, setRawIds] = useState("");
  const [inputHint, setInputHint] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const tokens = rawIds
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      setInputHint("Ingresá al menos un ID numérico de producto (ej: 1, 2, 3).");
      return;
    }

    const parsedIds = tokens.map((t) => Number(t));
    if (parsedIds.some((n) => !Number.isInteger(n) || n <= 0)) {
      setInputHint("Todos los IDs deben ser números enteros positivos.");
      return;
    }

    if (parsedIds.length > 10) {
      setInputHint("Podés proponer hasta 10 productos por vez.");
      return;
    }

    setInputHint(null);
    onPropose(parsedIds);
    setRawIds("");
  }

  return (
    <section className="card">
      <h2>Proponer productos del catálogo (DummyJSON)</h2>
      <p className="muted">
        Ingresá de 1 a 10 IDs separados por coma o espacio (ej: <code>1, 2, 999</code>).
      </p>
      <form onSubmit={handleSubmit} className="inline-form">
        <input
          type="text"
          value={rawIds}
          onChange={(e) => setRawIds(e.target.value)}
          placeholder="IDs de productos (ej. 1, 5, 12)"
          disabled={disabled || isProposing}
        />
        <button type="submit" disabled={disabled || isProposing}>
          {isProposing ? "Consultando catálogo..." : "Proponer"}
        </button>
      </form>

      {inputHint && <p className="alert alert-error">{inputHint}</p>}

      {lastResult && (
        <div className="proposal-feedback">
          {lastResult.addedIds.length > 0 && (
            <p className="alert alert-success">
              Agregados a la lista: {lastResult.addedIds.map((id) => `#${id}`).join(", ")}
            </p>
          )}
          {lastResult.failures.length > 0 && (
            <div className="alert alert-warning" role="status">
              <strong>Algunos productos no pudieron agregarse (solo vos ves este aviso):</strong>
              <ul>
                {lastResult.failures.map((f, idx) => (
                  <li key={`${f.productId}-${idx}`}>
                    <strong>#{f.productId}</strong> —{" "}
                    {REASON_LABELS[f.reason] ?? f.reason}: {f.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
