let consoleToken = ''

export function setConsoleToken(token) {
  consoleToken = token || ''
}

async function request(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(consoleToken ? { 'X-Orbit-Token': consoleToken } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  })

  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }

  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `请求失败 (${res.status})`
    const error = new Error(message)
    error.status = res.status
    error.data = data
    throw error
  }
  return data
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' })
}
