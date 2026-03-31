# Backend Workspace

This workspace owns the FastAPI service.

Why keep an extra backend on top of Matrix:

- Matrix is the messaging and federation substrate, not the full product layer.
- Free Voice still needs application-specific APIs for invite links, push delivery, token issuance, and call orchestration.
- The backend keeps browser and operator flows stable while the remaining pre-Matrix behavior is being removed.
- In the ideal end state, the project would rely on Matrix and adjacent infrastructure with a much thinner or no separate product service layer.

- `src/main.py`: application entry point
- `src/routes/`: HTTP route modules
- `src/helpers/`: integration and support logic
- `src/models/`: request and response schemas
- `src/cli/`: operator-facing backend helpers
- `tests/`: pytest coverage

Current backend responsibilities:

- Matrix-era sign-in and account bootstrap
- call-link creation and guest join flows
- push notification payload shaping and delivery
- TURN and LiveKit token issuance
- service-side integration glue around Matrix, Dendrite, and the remaining call stack

Direction note:

- the product is Matrix-only now
- old pre-Matrix behavior is still being phased out from the codebase and deployment model
- until that cleanup is complete, this service remains the place where product-specific integration logic is kept

Use:

```bash
cd backend
uv run pytest
uv run pytest tests/test_<domain>.py
```

Authoritative behavior lives in [openspec/specs/api-service/spec.md](../openspec/specs/api-service/spec.md).
