import { ProductCard } from "../components/ProductCard";
import { useScreenEvents } from "../hooks/useScreenEvents";

export function ScreenView() {
  const { roomCode, connectionState, products, participantCount } = useScreenEvents();

  return (
    <div className="container screen-container">
      <header className="app-header screen-header">
        <div>
          <h1>
            Ranking en Vivo · Lista <span className="room-badge">{roomCode}</span>
          </h1>
          <p className="muted">
            Actualización automática por Server-Sent Events (solo lectura) · Estado:{" "}
            <span className={`status-pill status-${connectionState}`}>
              {connectionState === "open"
                ? "En vivo"
                : connectionState === "connecting"
                  ? "Conectando..."
                  : "Reconectando..."}
            </span>
          </p>
        </div>
        <div className="screen-counter">
          <span className="counter-number">{participantCount}</span>
          <span className="counter-label">
            {participantCount === 1 ? "participante conectado" : "participantes conectados"}
          </span>
        </div>
      </header>

      <section className="card">
        {products.length === 0 ? (
          <p className="muted screen-empty">
            Esperando propuestas de los participantes...
          </p>
        ) : (
          <div className="product-list">
            {products.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                rank={index + 1}
                readOnly
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
