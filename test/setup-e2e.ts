import 'dotenv/config';

/**
 * Limites altos por padrão nos testes e2e.
 *
 * As suítes de auth fazem dezenas de logins e registros do mesmo IP; com o
 * limite de produção (5/min) elas seriam barradas por 429. O teste de rate
 * limiting sobrescreve estes valores ao criar o app, via createTestApp({...}).
 *
 * Sobrescreve o que veio do .env de propósito — o .env carrega valores de
 * produção, que não servem para a suíte.
 */
process.env.THROTTLE_LIMIT_DEFAULT = '10000';
process.env.THROTTLE_LIMIT_SENSITIVE = '10000';
process.env.THROTTLE_TTL_MS = '60000';
