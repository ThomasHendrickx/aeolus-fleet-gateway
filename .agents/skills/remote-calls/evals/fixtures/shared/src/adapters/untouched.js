import { request } from '../infra/network.js';
export const readWeather = (network) => request(network, {operation: 'weather'});
