import { z } from 'zod/v3'
import { DynamicStructuredTool } from '../OpenAPIToolkit/core'
import { TOOL_ARGS_PREFIX, formatToolError } from '../../../src/agents'
import { secureFetch } from '../../../src/httpSecurity'

export const SEQUENZY_API_BASE_URL = 'https://api.sequenzy.com/api/v1'

export const DUPLICATE_STRATEGIES = ['overwrite', 'merge', 'skip'] as const
export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled', 'waiting_approval', 'rejected'] as const

export interface SequenzyToolsConfig {
    apiKey: string
    actions: string[]
    duplicateStrategy?: (typeof DUPLICATE_STRATEGIES)[number]
}

interface SequenzyRequest {
    method: 'GET' | 'POST'
    path: string
    body?: Record<string, any>
    query?: Record<string, string | number>
    headers?: Record<string, string>
}

interface SequenzyAction {
    toolName: string
    description: string
    schema: z.ZodObject<any, any, any, any>
    errorLabel: string
    buildRequest: (params: any, config: SequenzyToolsConfig) => SequenzyRequest
}

const emailField = z.string().describe('Email address of the subscriber')
const jsonObject = z.record(z.any())

/** Copy only the fields that hold a value, so optional inputs are not sent as null or empty. */
const definedFields = (fields: Record<string, any>): Record<string, any> =>
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== ''))

export const SEQUENZY_ACTIONS: Record<string, SequenzyAction> = {
    addSubscriber: {
        toolName: 'sequenzy_add_subscriber',
        description: 'Create a subscriber in Sequenzy, or update one that already exists, with a name, tags and custom attributes',
        schema: z.object({
            email: emailField,
            firstName: z.string().optional().describe('First name'),
            lastName: z.string().optional().describe('Last name'),
            tags: z.array(z.string()).optional().describe('Tags to add, such as ["newsletter"]'),
            customAttributes: jsonObject.optional().describe('Custom attributes, such as {"plan": "pro"}')
        }),
        errorLabel: 'Error adding subscriber',
        buildRequest: (params, config) => ({
            method: 'POST',
            path: '/subscribers',
            body: definedFields({
                email: params.email,
                firstName: params.firstName,
                lastName: params.lastName,
                tags: params.tags?.length ? params.tags : undefined,
                customAttributes: params.customAttributes,
                duplicateStrategy: config.duplicateStrategy ?? 'overwrite'
            })
        })
    },
    getSubscriber: {
        toolName: 'sequenzy_get_subscriber',
        description: "Get a Sequenzy subscriber's status, tags, lists and custom attributes by email address",
        schema: z.object({ email: emailField }),
        errorLabel: 'Error getting subscriber',
        buildRequest: (params) => ({ method: 'GET', path: `/subscribers/${encodeURIComponent(params.email)}` })
    },
    addTag: {
        toolName: 'sequenzy_add_tag',
        description: 'Add a tag to a Sequenzy subscriber, creating the subscriber if needed. Tags can start automations',
        schema: z.object({ email: emailField, tag: z.string().describe('Tag name, such as premium') }),
        errorLabel: 'Error adding tag',
        buildRequest: (params) => ({ method: 'POST', path: '/subscribers/tags', body: { email: params.email, tag: params.tag } })
    },
    removeTag: {
        toolName: 'sequenzy_remove_tag',
        description: 'Remove a tag from a Sequenzy subscriber',
        schema: z.object({ email: emailField, tag: z.string().describe('Tag name to remove') }),
        errorLabel: 'Error removing tag',
        buildRequest: (params) => ({
            method: 'POST',
            path: '/subscribers/tags/remove',
            body: { email: params.email, tag: params.tag }
        })
    },
    triggerEvent: {
        toolName: 'sequenzy_trigger_event',
        description: 'Trigger a custom event, such as purchase.completed, for a Sequenzy subscriber. Events can start automations',
        schema: z.object({
            email: emailField,
            event: z.string().describe('Event name, such as purchase.completed'),
            properties: jsonObject.optional().describe('Event properties, such as {"amount": 9900, "currency": "USD"}'),
            eventId: z.string().optional().describe('Idempotency key. Sending the same ID again does not record a second event')
        }),
        errorLabel: 'Error triggering event',
        buildRequest: (params) => ({
            method: 'POST',
            path: '/subscribers/events',
            body: definedFields({
                email: params.email,
                event: params.event,
                properties: params.properties,
                eventId: params.eventId
            })
        })
    },
    sendEmail: {
        toolName: 'sequenzy_send_email',
        description: 'Send a transactional email with Sequenzy, either from a saved template slug or from a subject and HTML body',
        schema: z.object({
            to: z.string().describe('Recipient email address'),
            slug: z.string().optional().describe('Slug of a saved transactional email template'),
            subject: z.string().optional().describe('Email subject, required when no slug is set'),
            body: z.string().optional().describe('Email body as HTML, required when no slug is set'),
            variables: jsonObject.optional().describe('Template variables, such as {"name": "Ada"}'),
            idempotencyKey: z.string().optional().describe('Retrying with the same key does not send the email twice')
        }),
        errorLabel: 'Error sending email',
        buildRequest: (params) => {
            if (!params.slug && !(params.subject && params.body)) {
                throw new Error('Provide a template slug, or both a subject and an HTML body')
            }
            const content = params.slug ? { slug: params.slug } : { subject: params.subject, body: params.body }
            return {
                method: 'POST',
                path: '/transactional/send',
                body: definedFields({ to: params.to, ...content, variables: params.variables }),
                headers: params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : undefined
            }
        }
    },
    listCampaigns: {
        toolName: 'sequenzy_list_campaigns',
        description: 'List Sequenzy email campaigns with their status, subject and send dates',
        schema: z.object({
            status: z.enum(CAMPAIGN_STATUSES).optional().describe('Only list campaigns with this status'),
            limit: z.number().optional().describe('Number of campaigns to return, from 1 to 100. Default 20')
        }),
        errorLabel: 'Error listing campaigns',
        buildRequest: (params) => ({
            method: 'GET',
            path: '/campaigns',
            query: definedFields({
                status: params.status,
                limit: Math.min(Math.max(Math.trunc(Number(params.limit) || 20), 1), 100)
            })
        })
    }
}

class SequenzyTool extends DynamicStructuredTool {
    private action: SequenzyAction
    private config: SequenzyToolsConfig

    constructor(action: SequenzyAction, config: SequenzyToolsConfig) {
        super({
            name: action.toolName,
            description: action.description,
            schema: action.schema,
            baseUrl: SEQUENZY_API_BASE_URL,
            method: 'POST',
            headers: {}
        })
        this.action = action
        this.config = config
    }

    async _call(arg: any): Promise<string> {
        const params = { ...arg }
        try {
            const request = this.action.buildRequest(params, this.config)
            const query = request.query ? `?${new URLSearchParams(request.query as Record<string, string>).toString()}` : ''
            const response = await secureFetch(`${SEQUENZY_API_BASE_URL}${request.path}${query}`, {
                method: request.method,
                headers: {
                    ...request.headers,
                    Authorization: `Bearer ${this.config.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: request.body ? JSON.stringify(request.body) : undefined
            })
            const text = await response.text()
            if (!response.ok) {
                throw new Error(`Sequenzy API Error ${response.status}: ${text.split(this.config.apiKey).join('***')}`)
            }
            return text + TOOL_ARGS_PREFIX + JSON.stringify(params)
        } catch (error) {
            return formatToolError(`${this.action.errorLabel}: ${error}`, params)
        }
    }
}

export const createSequenzyTools = (config: SequenzyToolsConfig): DynamicStructuredTool[] =>
    config.actions.filter((action) => action in SEQUENZY_ACTIONS).map((action) => new SequenzyTool(SEQUENZY_ACTIONS[action], config))
