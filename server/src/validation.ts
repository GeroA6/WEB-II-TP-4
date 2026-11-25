import { DOMAIN_RULES } from "./config.js";
import type { ClientMessage, ErrorCode } from "../../shared/protocol.js";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function validateParticipantName(raw: unknown): ValidationResult<string> {
  if (typeof raw !== "string") {
    return {
      ok: false,
      code: "INVALID_NAME",
      message: "El nombre debe ser una cadena de texto.",
    };
  }

  const trimmed = raw.trim();
  const { participantNameMinLength, participantNameMaxLength } = DOMAIN_RULES;

  if (trimmed.length < participantNameMinLength || trimmed.length > participantNameMaxLength) {
    return {
      ok: false,
      code: "INVALID_NAME",
      message: `El nombre debe tener entre ${participantNameMinLength} y ${participantNameMaxLength} caracteres (sin contar espacios al inicio o final).`,
    };
  }

  return { ok: true, value: trimmed };
}

export function parseClientMessage(rawText: string): ValidationResult<ClientMessage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      code: "INVALID_JSON",
      message: "El mensaje recibido no es un JSON válido.",
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      code: "INVALID_MESSAGE",
      message: "El mensaje debe ser un objeto JSON.",
    };
  }

  if (typeof parsed.type !== "string" || parsed.type.trim() === "") {
    return {
      ok: false,
      code: "INVALID_MESSAGE",
      message: 'El mensaje debe incluir un campo "type" de tipo texto.',
    };
  }

  switch (parsed.type) {
    case "join": {
      const nameResult = validateParticipantName(parsed.name);
      if (!nameResult.ok) {
        return nameResult;
      }
      return {
        ok: true,
        value: { type: "join", name: nameResult.value },
      };
    }

    case "propose_products": {
      const { productIds } = parsed;
      if (!Array.isArray(productIds)) {
        return {
          ok: false,
          code: "INVALID_MESSAGE",
          message: 'El campo "productIds" debe ser un arreglo de IDs numéricos.',
        };
      }

      if (
        productIds.length === 0 ||
        productIds.length > DOMAIN_RULES.maxProductsPerProposal
      ) {
        return {
          ok: false,
          code: "INVALID_MESSAGE",
          message: `Debes proponer entre 1 y ${DOMAIN_RULES.maxProductsPerProposal} productos por vez.`,
        };
      }

      for (const id of productIds) {
        if (!isPositiveInteger(id)) {
          return {
            ok: false,
            code: "INVALID_MESSAGE",
            message: "Todos los IDs de producto deben ser números enteros positivos.",
          };
        }
      }

      return {
        ok: true,
        value: {
          type: "propose_products",
          productIds: productIds as number[],
        },
      };
    }

    case "vote":
    case "unvote":
    case "remove_product": {
      if (!isPositiveInteger(parsed.productId)) {
        return {
          ok: false,
          code: "INVALID_MESSAGE",
          message: 'El campo "productId" debe ser un número entero positivo.',
        };
      }

      return {
        ok: true,
        value: {
          type: parsed.type,
          productId: parsed.productId,
        },
      };
    }

    default:
      return {
        ok: false,
        code: "UNKNOWN_MESSAGE_TYPE",
        message: `Tipo de mensaje desconocido: "${parsed.type}".`,
      };
  }
}
