import csv from 'csvtojson'
import * as fs from 'fs'
import minimist from 'minimist'
import path from 'path'
import {exit} from 'process'
import {ArchiveUtils} from '../util/archive'
import {Block} from '../../webapp/src/blocks/block'
import {IPropertyTemplate, createBoard} from '../../webapp/src/blocks/board'
import {createBoardView} from '../../webapp/src/blocks/boardView'
import {createCard} from '../../webapp/src/blocks/card'
import {createTextBlock} from '../../webapp/src/blocks/textBlock'
import {Utils} from './utils'

// HACKHACK: To allow Utils.CreateGuid to work
(global.window as any) = {}

let markdownFolder: string

const optionColors = [
    // 'propColorDefault',
    'propColorGray',
    'propColorBrown',
    'propColorOrange',
    'propColorYellow',
    'propColorGreen',
    'propColorBlue',
    'propColorPurple',
    'propColorPink',
    'propColorRed',
]
let optionColorIndex = 0

async function main() {
    const args: minimist.ParsedArgs = minimist(process.argv.slice(2))

    const inputFolder = args['i']
    const outputFile = args['o'] || 'archive.focalboard'

    if (!inputFolder) {
        showHelp()
    }

    if (!fs.existsSync(inputFolder)) {
        console.log(`Folder not found: ${inputFolder}`)
        exit(2)
    }

    const inputFile = getCsvFilePath(inputFolder)
    if (!inputFile) {
        console.log(`.csv file not found in folder: ${inputFolder}`)
        exit(2)
    }

    console.log(`inputFile: ${inputFile}`)

    // Read input
    const input = await csv().fromFile(inputFile)

    console.log(`Read ${input.length} rows.`)

    console.log(input)

    const basename = path.basename(inputFile, '.csv')
    const components = basename.split(' ')
    components.pop()
    const title = components.join(' ')

    console.log(`title: ${title}`)

    markdownFolder = path.join(inputFolder, basename)

    // Convert
    const blocks = convert(input, title)

    // Save output
    // TODO: Stream output
    const outputData = ArchiveUtils.buildBlockArchive(blocks)
    fs.writeFileSync(outputFile, outputData)

    console.log(`Exported to ${outputFile}`)
}

function getCsvFilePath(inputFolder: string): string | undefined {
    const files = fs.readdirSync(inputFolder)
    const file = files.find(o => path.extname(o).toLowerCase() === '.csv')

    return file ? path.join(inputFolder, file) : undefined
}

function getMarkdown(cardTitle: string): string | undefined {
    if (!fs.existsSync(markdownFolder)) {return undefined}
    const files = fs.readdirSync(markdownFolder)
    const file = files.find((o) => {
        const basename = path.basename(o)
        const components = basename.split(' ')
        const fileCardTitle = components.slice(0, components.length - 1).join(' ')
        if (fileCardTitle === cardTitle) {
            return o
        }
    })

    if (file) {
        const filePath = path.join(markdownFolder, file)
        const markdown = fs.readFileSync(filePath, 'utf-8')

        // TODO: Remove header from markdown, which repets card title and properties
        return markdown
    }

    return undefined
}

function getColumns(input: any[]) {
    const row = input[0]
    const keys = Object.keys(row)
    // The first key (column) is the card title
    return keys.slice(1)
}

function fixValue(value: string): string {
    return value.replace(/^https:\/\/www\.notion\.so([0-9a-zA-Z])/g, '$1')
}

function createCardProperty(column: string, values: string[]): IPropertyTemplate {
    const urls = values.filter(value => /^https?:\/\/.+$/.test(value))
    if (urls.length / values.length > 0.8) {
        // url
        return {
            id: Utils.createGuid(),
            name: column,
            type: 'url',
            options: []
        }
    }

    const emails = values.filter(value => /^.+?@\w+?\.\w+$/.test(value))
    if (emails.length / values.length > 0.8) {
        // email
        return {
            id: Utils.createGuid(),
            name: column,
            type: 'email',
            options: []
        }
    }

    const phones = values.filter(value => /^(0?9\d{9}|(0|\+98)\d{10})$/.test(value))
    if (phones.length / values.length > 0.8) {
        // phone
        return {
            id: Utils.createGuid(),
            name: column,
            type: 'phone',
            options: []
        }
    }

    const numbers = values.filter(value => /^\d+$/.test(value))
    if (numbers.length / values.length > 0.8) {
        // number
        return {
            id: Utils.createGuid(),
            name: column,
            type: 'number',
            options: []
        }
    }

    const dates = values.filter(value => !isNaN(Date.parse(value)))
    if (dates.length / values.length > 0.8) {
        // date
        return {
            id: Utils.createGuid(),
            name: column,
            type: 'date',
            options: []
        }
    }

    const uniqueValues = new Set(values)
    const allSplitOptions = values.map((value) => value.split(", ")).flat()
    const uniqueSplitOptions = new Set(allSplitOptions)
    if (uniqueValues.size === 2 && uniqueValues.has('Yes') && uniqueValues.has('No')) {
        // checkbox
        return {
            id: Utils.createGuid(),
            name: column,
            type: 'checkbox',
            options: []
        }
    }
    if (allSplitOptions.length > 0 && uniqueSplitOptions.size / allSplitOptions.length < 0.9) {
        if (allSplitOptions.length / values.length > 1.1) {
            // multi-select
            return {
                id: Utils.createGuid(),
                name: column,
                type: 'multiSelect',
                options: [...uniqueSplitOptions].map(o => {
                    const color = optionColors[optionColorIndex % optionColors.length]
                    optionColorIndex = (optionColorIndex + 1) % optionColors.length
                    return {
                        id: Utils.createGuid(),
                        value: o,
                        color: color,
                    }
                })
            }
        }
        else {
            // select
            return {
                id: Utils.createGuid(),
                name: column,
                type: 'select',
                options: [...new Set(values)].map(o => {
                    const color = optionColors[optionColorIndex % optionColors.length]
                    optionColorIndex = (optionColorIndex + 1) % optionColors.length
                    return {
                        id: Utils.createGuid(),
                        value: o,
                        color: color,
                    }
                })
            }
        }
    }

    return {
        id: Utils.createGuid(),
        name: column,
        type: 'text',
        options: []
    }
}

function convert(input: any[], title: string): Block[] {
    const blocks: Block[] = []

    // Board
    const board = createBoard()
    console.log(`Board: ${title}`)
    board.rootId = board.id
    board.title = title
    board.fields.cardProperties = []

    // Each column is a card property
    const columns = getColumns(input)
    const columnValues: {[key: string]: string[]} = {}
    input.forEach(row => {
        columns.forEach(column => {
            const value = fixValue(row[column])
            if (!columnValues[column]) {
                columnValues[column] = []
            }
            if (!value) {
                // Skip empty values
                return
            }
            columnValues[column].push(value)
        })
    })

    columns.forEach(column => {
        const cardProperty: IPropertyTemplate = createCardProperty(column, columnValues[column])
        board.fields.cardProperties.push(cardProperty)
    })

    // Set all column types to select
    // TODO: Detect column type
    blocks.push(board)

    // Board view
    const view = createBoardView()
    view.title = 'Gallery View'
    view.fields.viewType = 'gallery'
    view.rootId = board.id
    view.parentId = board.id
    blocks.push(view)

    // Cards
    input.forEach(row => {
        const keys = Object.keys(row)
        console.log(keys)
        if (keys.length < 1) {
            console.error(`Expected at least one column`)
            return blocks
        }

        const titleKey = keys[0]
        const title = row[titleKey]

        console.log(`Card: ${title}`)

        const outCard = createCard()
        outCard.title = title
        outCard.rootId = board.id
        outCard.parentId = board.id

        // Card properties, skip first key which is the title
        for (const key of keys.slice(1)) {
            const value = fixValue(row[key])
            if (!value) {
                // Skip empty values
                continue
            }

            const cardProperty = board.fields.cardProperties.find((o) => o.name === key)!
            if (cardProperty.type === "checkbox") {
                if (value === "Yes" || value === "No") {
                    outCard.fields.properties[cardProperty.id] = {"Yes": "true", "No": "false"}[value]
                }
            }
            else if (cardProperty.type === "select") {
                const option = cardProperty.options.find((o) => o.value === value)
                if (option) {
                    outCard.fields.properties[cardProperty.id] = option.id
                }
            }
            else if (cardProperty.type === "multiSelect") {
                outCard.fields.properties[cardProperty.id] = value.split(", ").map(v => {
                    const option = cardProperty.options.find((o) => o.value === v)
                    return option ? option.id : ""
                })
            }
            else if (cardProperty.type === "date") {
                const date = Date.parse(value)
                outCard.fields.properties[cardProperty.id] = isNaN(date) ? value : `{"from":${date}}`
            }
            else {
                outCard.fields.properties[cardProperty.id] = value
            }
        }

        blocks.push(outCard)

        // Card notes from markdown
        const markdown = getMarkdown(title)
        if (markdown) {
            console.log(`Markdown: ${markdown.length} bytes`)
            const text = createTextBlock()
            text.title = markdown
            text.rootId = board.id
            text.parentId = outCard.id
            blocks.push(text)

            outCard.fields.contentOrder = [text.id]
        }
    })

    console.log('')
    console.log(`Found ${input.length} card(s).`)

    return blocks
}

function showHelp() {
    console.log('import -i <input.json> -o [output.focalboard]')
    exit(1)
}

main()
