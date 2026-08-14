import { NarrativeResponseSchema, type IntelligenceRequest, type ModelGateway } from "./modelGateway.js";
import { narrativeCitesOnlyKnownFigures } from "./factSheet.js";
import { StubGateway } from "./stubGateway.js";

export type NarrativeSource = "AI" | "FALLBACK_TEMPLATE";

export interface IntelligenceResponse {
  narrative: string;
  source: NarrativeSource;
  gatewayId: string;
}

/**
 * The single entry point the rest of the app calls for anything AI-shaped
 * (§21). Validates every response against a schema and against the fact
 * sheet's own numbers (§45), and falls back to a deterministic template on
 * any failure so an AI outage or malformed response never breaks the
 * dashboard (§44) — the fallback path uses the exact same fact sheet, just
 * phrased mechanically instead of by a model.
 */
export class FinancialIntelligenceService {
  private gateway: ModelGateway;
  private fallbackGateway = new StubGateway();

  constructor(gateway: ModelGateway) {
    this.gateway = gateway;
  }

  async respond(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    try {
      const raw = await this.gateway.generateNarrative(request);
      const parsed = NarrativeResponseSchema.safeParse(raw);
      if (!parsed.success) {
        return this.fallback(request, "schema_validation_failed");
      }
      if (!narrativeCitesOnlyKnownFigures(parsed.data.narrative, request.factSheet)) {
        return this.fallback(request, "narrative_cited_unknown_figure");
      }
      return { narrative: parsed.data.narrative, source: "AI", gatewayId: this.gateway.id };
    } catch {
      return this.fallback(request, "gateway_error");
    }
  }

  private async fallback(request: IntelligenceRequest, _reason: string): Promise<IntelligenceResponse> {
    const raw = await this.fallbackGateway.generateNarrative(request);
    const parsed = NarrativeResponseSchema.parse(raw);
    return { narrative: parsed.narrative, source: "FALLBACK_TEMPLATE", gatewayId: this.fallbackGateway.id };
  }
}
