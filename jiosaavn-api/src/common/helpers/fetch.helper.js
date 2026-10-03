import { userAgents } from '../constants/index.js';
export const useFetch = async ({ endpoint, params, context }) => {
    const url = new URL('https://www.jiosaavn.com/api.php');
    url.searchParams.append('__call', endpoint.toString());
    url.searchParams.append('_format', 'json');
    url.searchParams.append('_marker', '0');
    url.searchParams.append('api_version', '4');
    url.searchParams.append('ctx', context || 'web6dot0');
    Object.keys(params).forEach((key) => url.searchParams.append(key, String(params[key])));
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json', 'User-Agent': randomUserAgent },
        signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => null);
    return { data, ok: response.ok };
};
