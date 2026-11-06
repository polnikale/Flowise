import { convertMultiOptionsToStringArray, getCredentialData, getCredentialParam } from '../../../src/utils'
import { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
import { DUPLICATE_STRATEGIES, createSequenzyTools } from './core'

class Sequenzy_Tools implements INode {
    label: string
    name: string
    version: number
    type: string
    icon: string
    category: string
    description: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]

    constructor() {
        this.label = 'Sequenzy'
        this.name = 'sequenzyTool'
        this.version = 1.0
        this.type = 'Sequenzy'
        this.icon = 'sequenzy.svg'
        this.category = 'Tools'
        this.description = 'Manage subscribers, tags and events, send transactional email and list campaigns in Sequenzy'
        this.baseClasses = [this.type, 'Tool']
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['sequenzyApi']
        }
        this.inputs = [
            {
                label: 'Actions',
                name: 'sequenzyActions',
                type: 'multiOptions',
                options: [
                    { label: 'Add or Update Subscriber', name: 'addSubscriber' },
                    { label: 'Get Subscriber', name: 'getSubscriber' },
                    { label: 'Add Tag', name: 'addTag' },
                    { label: 'Remove Tag', name: 'removeTag' },
                    { label: 'Trigger Event', name: 'triggerEvent' },
                    { label: 'Send Transactional Email', name: 'sendEmail' },
                    { label: 'List Campaigns', name: 'listCampaigns' }
                ]
            },
            {
                label: 'If Subscriber Exists',
                name: 'duplicateStrategy',
                type: 'options',
                description:
                    'Used by Add or Update Subscriber. Overwrite replaces fields with the values sent, Merge only fills in missing fields, Skip leaves the subscriber unchanged',
                options: [
                    { label: 'Overwrite', name: 'overwrite' },
                    { label: 'Merge', name: 'merge' },
                    { label: 'Skip', name: 'skip' }
                ],
                default: 'overwrite',
                optional: true,
                additionalParams: true
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const apiKey = getCredentialParam('sequenzyApiKey', credentialData, nodeData)
        if (!apiKey) {
            throw new Error('No Sequenzy API key provided')
        }

        const actions = convertMultiOptionsToStringArray(nodeData.inputs?.sequenzyActions)
        const strategy = nodeData.inputs?.duplicateStrategy as string
        const duplicateStrategy = DUPLICATE_STRATEGIES.find((value) => value === strategy) ?? 'overwrite'

        return createSequenzyTools({ apiKey, actions, duplicateStrategy })
    }
}

module.exports = { nodeClass: Sequenzy_Tools }
