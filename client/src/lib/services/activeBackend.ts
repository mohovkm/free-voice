import * as matrixBackend from './backends/matrix';
import { getPlaywrightBackend } from './playwrightBackend';

export const backend = (getPlaywrightBackend() ?? matrixBackend) as typeof matrixBackend;
