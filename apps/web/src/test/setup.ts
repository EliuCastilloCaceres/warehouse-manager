import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';

// jsdom no expone TextEncoder/TextDecoder, y react-router los usa al cargar.
Object.assign(globalThis, { TextEncoder, TextDecoder });
