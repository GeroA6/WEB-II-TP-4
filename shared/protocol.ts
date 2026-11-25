// ============================================================================
// Contrato compartido de modelos, mensajes WebSocket y eventos SSE (TP4)
// Compartido entre el servidor Node.js y el cliente React.
// ============================================================================

export interface Participant {
  id: string;
  name: string;
}

export interface ProductItem {
  id: number;
  title: string;
  price: number;
  thumbnail: string;
  proposedById: string;
  proposedByName: string;
  voterIds: string[];
  voteCount: number;
}

export type ProposalFailureReason =
  | "not_found"
  | "timeout"
  | "already_exists"
  | "catalog_error";

export interface ProposalFailure {
  productId: number;
  reason: ProposalFailureReason;
  message: string;
}

export type ErrorCode =
  | "INVALID_JSON"
  | "INVALID_MESSAGE"
  | "UNKNOWN_MESSAGE_TYPE"
  | "INVALID_NAME"
  | "NAME_TAKEN"
  | "NOT_JOINED"
  | "ALREADY_JOINED"
  | "PRODUCT_NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_VOTE_ACTION";

// ----------------------------------------------------------------------------
// Mensajes Cliente -> Servidor (WebSocket)
// ----------------------------------------------------------------------------

export interface JoinMessage {
  type: "join";
  name: string;
}

export interface ProposeProductsMessage {
  type: "propose_products";
  productIds: number[];
}

export interface VoteMessage {
  type: "vote";
  productId: number;
}

export interface UnvoteMessage {
  type: "unvote";
  productId: number;
}

export interface RemoveProductMessage {
  type: "remove_product";
  productId: number;
}

export type ClientMessage =
  | JoinMessage
  | ProposeProductsMessage
  | VoteMessage
  | UnvoteMessage
  | RemoveProductMessage;

// ----------------------------------------------------------------------------
// Mensajes Servidor -> Participante (WebSocket)
// ----------------------------------------------------------------------------

export interface WelcomeMessage {
  type: "welcome";
  self: Participant;
  participants: Participant[];
  products: ProductItem[];
}

export interface ParticipantsUpdatedMessage {
  type: "participants_updated";
  participants: Participant[];
}

export interface ProductsUpdatedMessage {
  type: "products_updated";
  products: ProductItem[];
}

export interface ProposalResultMessage {
  type: "proposal_result";
  addedIds: number[];
  failures: ProposalFailure[];
}

export interface ErrorMessage {
  type: "error";
  code: ErrorCode;
  message: string;
}

export type ServerMessage =
  | WelcomeMessage
  | ParticipantsUpdatedMessage
  | ProductsUpdatedMessage
  | ProposalResultMessage
  | ErrorMessage;

// ----------------------------------------------------------------------------
// Eventos Servidor -> Pantalla (Server-Sent Events)
// ----------------------------------------------------------------------------

export interface ScreenStateEvent {
  products: ProductItem[];
  participantCount: number;
}
