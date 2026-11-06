import { INodeParams, INodeCredential } from '../src/Interface'

class SequenzyApi implements INodeCredential {
    label: string
    name: string
    version: number
    description: string
    inputs: INodeParams[]

    constructor() {
        this.label = 'Sequenzy API'
        this.name = 'sequenzyApi'
        this.version = 1.0
        this.description =
            'Create an API key in the Sequenzy dashboard. Refer to the <a target="_blank" href="https://docs.sequenzy.com/api-reference/introduction">Sequenzy API reference</a> for details'
        this.inputs = [
            {
                label: 'Sequenzy API Key',
                name: 'sequenzyApiKey',
                type: 'password'
            }
        ]
    }
}

module.exports = { credClass: SequenzyApi }
