const mockSecureFetch = jest.fn()

jest.mock('../../../src/httpSecurity', () => ({
    secureFetch: (...args: any[]) => mockSecureFetch(...args)
}))

jest.mock('../../../src/utils', () => ({
    convertMultiOptionsToStringArray: (value: string) => JSON.parse(value),
    getCredentialData: jest.fn(async () => ({ sequenzyApiKey: 'test-sequenzy-api-key-placeholder' })),
    getCredentialParam: (name: string, credentialData: Record<string, string>) => credentialData[name]
}))

import { TOOL_ARGS_PREFIX } from '../../../src/agents'
import { SEQUENZY_API_BASE_URL, createSequenzyTools } from './core'

// Placeholder credential for the mocked API (not a real key).
const API_KEY = 'test-sequenzy-api-key-placeholder'

const jsonResponse = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
})

const toolFor = (action: string, duplicateStrategy?: 'overwrite' | 'merge' | 'skip') => {
    const [tool] = createSequenzyTools({ apiKey: API_KEY, actions: [action], duplicateStrategy })
    return tool as any
}

const lastRequest = () => {
    const [url, init] = mockSecureFetch.mock.calls[mockSecureFetch.mock.calls.length - 1]
    return { url, init, body: init.body ? JSON.parse(init.body) : undefined }
}

describe('Sequenzy tools', () => {
    beforeEach(() => {
        mockSecureFetch.mockReset()
        mockSecureFetch.mockResolvedValue(jsonResponse(200, { success: true }))
    })

    it('creates one tool per known action and ignores unknown ones', () => {
        const tools = createSequenzyTools({ apiKey: API_KEY, actions: ['addTag', 'listCampaigns', 'deleteEverything'] })

        expect(tools.map((tool) => tool.name)).toEqual(['sequenzy_add_tag', 'sequenzy_list_campaigns'])
    })

    it('adds a subscriber with the bearer key and the chosen duplicate strategy', async () => {
        const result = await toolFor('addSubscriber', 'merge')._call({
            email: 'ada@example.com',
            firstName: 'Ada',
            tags: ['newsletter'],
            customAttributes: { plan: 'pro' }
        })

        const { url, init, body } = lastRequest()
        expect(url).toBe(`${SEQUENZY_API_BASE_URL}/subscribers`)
        expect(init.method).toBe('POST')
        expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`)
        expect(body).toEqual({
            email: 'ada@example.com',
            firstName: 'Ada',
            tags: ['newsletter'],
            customAttributes: { plan: 'pro' },
            duplicateStrategy: 'merge'
        })
        expect(result.startsWith('{"success":true}' + TOOL_ARGS_PREFIX)).toBe(true)
    })

    it('defaults to overwrite and leaves out empty optional fields', async () => {
        await toolFor('addSubscriber')._call({ email: 'ada@example.com', lastName: '', tags: [] })

        expect(lastRequest().body).toEqual({ email: 'ada@example.com', duplicateStrategy: 'overwrite' })
    })

    it('gets a subscriber with the email escaped in the path', async () => {
        await toolFor('getSubscriber')._call({ email: 'ada+test@example.com' })

        const { url, init } = lastRequest()
        expect(url).toBe(`${SEQUENZY_API_BASE_URL}/subscribers/ada%2Btest%40example.com`)
        expect(init.method).toBe('GET')
        expect(init.body).toBeUndefined()
    })

    it.each([
        ['addTag', '/subscribers/tags'],
        ['removeTag', '/subscribers/tags/remove']
    ])('%s posts the email and tag', async (action, path) => {
        await toolFor(action)._call({ email: 'ada@example.com', tag: 'premium' })

        expect(lastRequest().url).toBe(`${SEQUENZY_API_BASE_URL}${path}`)
        expect(lastRequest().body).toEqual({ email: 'ada@example.com', tag: 'premium' })
    })

    it('triggers an event with properties and an idempotency key', async () => {
        await toolFor('triggerEvent')._call({
            email: 'ada@example.com',
            event: 'purchase.completed',
            properties: { amount: 9900 },
            eventId: 'order_123'
        })

        expect(lastRequest().url).toBe(`${SEQUENZY_API_BASE_URL}/subscribers/events`)
        expect(lastRequest().body).toEqual({
            email: 'ada@example.com',
            event: 'purchase.completed',
            properties: { amount: 9900 },
            eventId: 'order_123'
        })
    })

    it('sends a template email with variables and an Idempotency-Key header', async () => {
        await toolFor('sendEmail')._call({
            to: 'ada@example.com',
            slug: 'welcome-email',
            subject: 'ignored when a slug is set',
            variables: { name: 'Ada' },
            idempotencyKey: 'signup-ada'
        })

        const { url, init, body } = lastRequest()
        expect(url).toBe(`${SEQUENZY_API_BASE_URL}/transactional/send`)
        expect(init.headers['Idempotency-Key']).toBe('signup-ada')
        expect(body).toEqual({ to: 'ada@example.com', slug: 'welcome-email', variables: { name: 'Ada' } })
    })

    it('sends direct content when no slug is set', async () => {
        await toolFor('sendEmail')._call({ to: 'ada@example.com', subject: 'Hello', body: '<p>Hi</p>' })

        expect(lastRequest().body).toEqual({ to: 'ada@example.com', subject: 'Hello', body: '<p>Hi</p>' })
        expect(lastRequest().init.headers['Idempotency-Key']).toBeUndefined()
    })

    it('rejects an email without a slug or subject and body before calling the API', async () => {
        const result = await toolFor('sendEmail')._call({ to: 'ada@example.com', subject: 'Hello' })

        expect(mockSecureFetch).not.toHaveBeenCalled()
        expect(result).toContain('Error sending email: Error: Provide a template slug, or both a subject and an HTML body')
    })

    it('lists campaigns with a status filter and a clamped limit', async () => {
        await toolFor('listCampaigns')._call({ status: 'sent', limit: 500 })
        expect(lastRequest().url).toBe(`${SEQUENZY_API_BASE_URL}/campaigns?status=sent&limit=100`)

        await toolFor('listCampaigns')._call({})
        expect(lastRequest().url).toBe(`${SEQUENZY_API_BASE_URL}/campaigns?limit=20`)
    })

    it('returns API errors as tool output with the key redacted', async () => {
        mockSecureFetch.mockResolvedValue(jsonResponse(401, { success: false, error: `Invalid API key ${API_KEY}` }))

        const result = await toolFor('getSubscriber')._call({ email: 'ada@example.com' })

        expect(result).toContain('Error getting subscriber: Error: Sequenzy API Error 401')
        expect(result).toContain('Invalid API key ***')
        expect(result).not.toContain(API_KEY)
    })

    it('returns network failures as tool output', async () => {
        mockSecureFetch.mockRejectedValue(new Error('connect ECONNREFUSED'))

        const result = await toolFor('addTag')._call({ email: 'ada@example.com', tag: 'vip' })

        expect(result).toContain('Error adding tag: Error: connect ECONNREFUSED')
    })
})

describe('Sequenzy node', () => {
    const { nodeClass: Sequenzy_Tools } = require('./Sequenzy')

    it('builds the selected tools from the credential', async () => {
        const node = new Sequenzy_Tools()
        const tools = await node.init({ credential: 'cred-id', inputs: { sequenzyActions: '["getSubscriber","triggerEvent"]' } }, '', {})

        expect(node.credential.credentialNames).toEqual(['sequenzyApi'])
        expect(tools.map((tool: any) => tool.name)).toEqual(['sequenzy_get_subscriber', 'sequenzy_trigger_event'])
    })

    it('fails without an API key', async () => {
        const utils = require('../../../src/utils')
        utils.getCredentialData.mockResolvedValueOnce({})

        await expect(new Sequenzy_Tools().init({ credential: 'cred-id', inputs: {} }, '', {})).rejects.toThrow(
            'No Sequenzy API key provided'
        )
    })
})
