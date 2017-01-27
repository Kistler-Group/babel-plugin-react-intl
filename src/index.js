/*
 * Copyright 2015, Yahoo Inc.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

import * as p from 'path'
import {writeFileSync} from 'fs'
import {sync as mkdirpSync} from 'mkdirp'
import {includes, last, head} from 'lodash'
import printICUMessage from './print-icu-message'
import { colors } from 'colors'

const COMPONENT_NAMES = [
  'FormattedMessage',
  'FormattedHTMLMessage',
]

const TRANSLATE_FUNCTION_NAME = 'translate'
const TRANSLATE_MODULE_SOURCE_NAME = 'skybase-core/utils/translate'

const DEFINE_MESSAGES_FUNCTION_NAME = 'defineMessages'
const DEFINE_MESSAGES_MODULE_SOURCE_NAME = 'skybase-core/utils/define-messages'

const DEFAULT_REACT_INTL_SOURCE_NAME = 'react-intl'
const DESCRIPTOR_PROPS = new Set(['id', 'description'])

// @todo Move to plugin's internal state.
let importSet = false
let convertedClassNames = []

const CLASS_TYPES = {
  CLASS: 'CLASS',
  STATELESS_FUNCTION: 'STATELESS_FUNCTION',
}

let classType = null

const developmentMode = process.env['NODE_ENV'] === 'development'

/**
 * @desc
 * Parses expression and tries to convert it into string.
 *
 * Supports string concatenation
 *
 * @param arg
 * @returns {*}
 */
function getStringFromExpression(t, arg) {
  if (t.isBinaryExpression(arg)) {
    // Now we support just simple string concatenation ( 'a' + 'c' )
    if (arg.operator === '+') {
      return getStringFromExpression(t, arg.left) + getStringFromExpression(t, arg.right)
    }
  } else if (t.isStringLiteral(arg)) {
    return arg.value
  }
}

export default function ({types: t}) {

  function storeMessage({id, description}, path, state) {
    const {opts, reactIntl} = state

    if (!id) {
      throw path.buildCodeFrameError(
        '[React Intl] Message Descriptors require an `id` attribute.'
      )
    }

    if (reactIntl.messages.has(id)) {
      const existing = reactIntl.messages.get(id)

      if (description !== existing.description) {
        throw path.buildCodeFrameError(
          `[React Intl] Duplicate message id: "${id}", ` +
          'but the `description` are different.'
        )
      }
    }

    if (opts.enforceDescriptions && !description) {
      throw path.buildCodeFrameError(
        '[React Intl] Message must have a `description`.'
      )
    }

    reactIntl.messages.set(id, {id, description})
  }

  function customReferencesImport(moduleSource, importName, sourcePathNormalizer) {
    if (!this.isReferencedIdentifier()) {
      return false
    }

    const binding = this.scope.getBinding(this.node.name)
    if (!binding || binding.kind !== "module") {
      return false
    }

    const {path} = binding
    const parent = path.parentPath

    if (!parent.isImportDeclaration()) {
      return false
    }

    const normalizedSource = sourcePathNormalizer
      ? sourcePathNormalizer(parent.node.source.value)
      : parent.node.source.value

    if (normalizedSource === moduleSource) {
      if (!importName) {
        return true
      }
    } else {
      return false
    }

    if (path.isImportDefaultSpecifier() && importName === "default") {
      return true
    }

    if (path.isImportNamespaceSpecifier() && importName === "*") {
      return true
    }

    if (path.isImportSpecifier() && path.node.imported.name === importName) {
      return true
    }

    return false
  }

  /**
   * @desc
   * Removes first part of path to make it comparable with relative path.
   *
   * For example:
   * The path ../../../../src/skybase-core/...
   *
   * will be converted into:
   * skybase-core/...
   *
   * @param sourcePath
   * @returns {*}
   */
  function normalizer(sourcePath) {
    // @todo Load dynamically from .babelrc if possible.
    const aliases = [
      'skybase-components',
      'skybase-core',
      'skybase-shell',
      'skybase-styling',
    ]
    let result = sourcePath

    aliases.forEach(alias => {
      result = result.replace(new RegExp('^.*?' + alias), alias)
    })

    return result
  }

  function referencesImport(path, mod, importedNames) {
    if (!(path.isIdentifier() || path.isJSXIdentifier())) {
      return false
    }

    return importedNames.some((name) => customReferencesImport.apply(path, [mod, name, normalizer]))
  }

  function isSuperClassSupported(superClass) {
    if (t.isMemberExpression(superClass)) {
      if (superClass.object.name === 'React' && superClass.property.name === 'Component') {
        return true
      }
    }

    if (t.isIdentifier(superClass)) {
      const {name} = superClass
      // @todo Check if 'Component' is imported from react package.
      if (includes(['Component', 'SbBaseComponent'], name)) {
        return true
      }
    }

    return false
  }

  function processClassComponent(path, state) {
    const declaration = path.node.declaration

    let className = 'TempClass'
    if (declaration.id) {
      className = declaration.id.name
    }

    const newClassName = '_' + className

    // We can't inject react-intl into our base component, it's used for extending other (injected) classes.
    if (className === 'SbBaseComponent') {
      return
    }

    consoleLog('  > Object:', className.yellow)

    const {superClass} = declaration
    if (!superClass) {
      consoleLog('    > Ignored:', 'Has no superclass.')
      return
    }

    // @todo Very naive implementation, handle also extends of React.Component
    if (!isSuperClassSupported(superClass)) {
      consoleLog('    > Ignored:', 'Is not extending supported superclass.')
      return
    }

    if (includes(convertedClassNames, className)) {
      return
    }

    convertedClassNames.push(newClassName)
    consoleLog('    > Injected!'.green)

    path.node.declaration.id = t.identifier(newClassName)

    if (!importSet) {
      path.insertBefore(
        t.importDeclaration(
          [
            t.importSpecifier(
              t.identifier('injectIntl'), // local
              t.identifier('injectIntl')  // imported
            )
          ],
          t.stringLiteral(DEFAULT_REACT_INTL_SOURCE_NAME)
        )
      )

      importSet = true
    }

    // @todo Refactor! It's located here twice!
    path.insertAfter(
      t.exportNamedDeclaration(
        t.variableDeclaration(
          'const',  // kind
          [
            t.variableDeclarator(
              t.identifier(className),
              t.callExpression(
                t.identifier('injectIntl'),
                [
                  t.identifier(newClassName)
                ]
              )
            )
          ]
        ),    // declaration
        [],   // specifiers
        null  // source (StringLiteral)
      )
    )
  }

  function isSupportedComponent(path) {
    const { node } = path
    const { declaration } = node
    let body

    if (t.isVariableDeclaration(declaration)) {
      // Named function: export const Xyz = .....

      const { declarations } = declaration
      const { name } = declarations[0].id
      const initPart = declarations[0].init

      body = initPart.body

      consoleLog('  > Object:', name.yellow)

      // If the first letter of function is capital, then we consider it as a react component.
      // First, check first letter of name is capital.
      if (name[0] !== name[0].toUpperCase()) {
        consoleLog('    > Ignored:'.grey, 'Is not camelcase'.grey)

        return false
      }

      // then, init part must be an arrow function.
      if (!t.isArrowFunctionExpression(initPart)) {
        consoleLog('    > Ignored:'.grey, 'Is not arrow function'.grey)
        return false
      }

    } else if (t.isArrowFunctionExpression(declaration)) {
      // Nameless function: export default () => .....
      body = declaration.body
    }

    // @todo support also JSX no-return (arrow) statement, .e.g. const x = () => (<p>hello</p>)
    if (!t.isBlockStatement(body)) {
      consoleLog('    > Ignored:'.grey, 'Has no block statement'.grey)
      return
    }

    const blockBody = body.body
    const lastStatement = last(blockBody)

    if (!t.isReturnStatement(lastStatement)) {
      // @todo Support more returns, e.g. if (1==1) { return (<p>X</p>) } else { return (<p>Y</p>) }
      consoleLog('    > Ignored:'.grey, 'Has no return statement at the end.'.grey)
      return false
    }

    return t.isJSXElement(lastStatement.argument)
  }

  function processStatelessComponent(path, state) {
    if (!isSupportedComponent(path)) {
      return
    }

    const { node } = path
    const { declaration } = node
    let className = 'TempObj'
    let funcDeclaration

    if (t.isVariableDeclaration(declaration)) {
      funcDeclaration = path.node.declaration.declarations[0]
      className = funcDeclaration.id.name
    } else if (t.isArrowFunctionExpression(declaration)) {
      funcDeclaration = t.variableDeclarator(t.identifier(className), path.node.declaration)
    }

    const newClassName = '_' + className

    if (includes(convertedClassNames, className)) {
      return
    }

    convertedClassNames.push(newClassName)
    convertedClassNames.push(className)

    // funcDeclaration.id = t.stringLiteral(newClassName)
    funcDeclaration.id = t.identifier(newClassName)

    path.replaceWith(
      t.exportNamedDeclaration(
        t.variableDeclaration(
          'const',  // kind
          [
            funcDeclaration
          ]
        ),    // declaration
        [],   // specifiers
        null  // source (StringLiteral)
      )
    )

    consoleLog('    > Injected!'.green)

    if (!importSet) {
      path.insertBefore(
        t.importDeclaration(
          [
            t.importSpecifier(
              t.identifier('injectIntl'), // local
              t.identifier('injectIntl') // imported
            )
          ],
          t.stringLiteral(DEFAULT_REACT_INTL_SOURCE_NAME)
        )
      )

      importSet = true
    }

    path.insertAfter(
      t.exportNamedDeclaration(
        t.variableDeclaration(
          'const',  // kind
          [
            t.variableDeclarator(
              t.identifier(className),
              t.callExpression(
                t.identifier('injectIntl'),
                [
                  t.identifier(newClassName)
                ]
              )
            )
          ]
        ),    // declaration
        [],   // specifiers
        null  // source (StringLiteral)
      )
    )
  }

  function getJSXAttributeById(path, id) {
    const attributes = path.get('attributes')
    const attribute = attributes.filter(attr => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.node.name) && attr.node.name.name === id)

    return attribute ? head(attribute) : null
  }

  // @todo Implement some smart detection of props variable.
  function getPropVariable(path) {
    const thisProps = t.memberExpression(
      t.thisExpression(),
      t.identifier('props.intl.formatMessage'),
      false
    ) // result: this.props

    return classType == CLASS_TYPES.CLASS ? thisProps : t.identifier('typeof props != \'undefined\' ? props.intl.formatMessage : null')

  }

  function propertiesToObject(t, properties) {
    let result = {}

    properties.forEach(property => {
      const {name} = property.key
      const value = getStringFromExpression(t, property.value)

      result[name] = value
    })

    return result
  }

  function consoleLog() {
    if (developmentMode) {
      const args = Array.prototype.slice.call(arguments)
      console.log.apply(this, args)
    }
  }

  return {
    visitor: {
      Program: {
        enter(path, state) {
          const {file, opts} = state
          const {basename, filename} = file.opts

          consoleLog('>', filename)

          state.reactIntl = {
            messages: new Map(),
          }

          importSet = false
          convertedClassNames = []
        },

        exit(path, state) {
          const {file, opts, reactIntl} = state
          const {basename, filename} = file.opts
          const descriptors = [...reactIntl.messages.values()]

          file.metadata['react-intl'] = {messages: descriptors}

          if (!opts.messagesDir) {
            return
          }

          if (opts.messagesDir && descriptors.length > 0) {
            // Make sure the relative path is "absolute" before
            // joining it with the `messagesDir`.
            const relativePath = p.join(
              p.sep,
              p.relative(process.cwd(), filename)
            )

            const messagesFilename = p.join(
              opts.messagesDir,
              p.dirname(relativePath),
              basename + '.json'
            )

            const normalizedMessages = descriptors
              .map(message => {
                if (message.description == null) {
                  delete message['description']
                }

                return message
              })
              // Sort message alphabetically by 'id' attribute.
              .sort((a, b) => {
                a = a.id.toLowerCase()
                b = b.id.toLowerCase()

                if (a > b) {
                  return 1
                }
                else if (a < b) {
                  return -1
                }
                else {
                  return 0
                }
              })

            let messagesFile = JSON.stringify(normalizedMessages, null, 2)

            mkdirpSync(p.dirname(messagesFilename))
            writeFileSync(messagesFilename, messagesFile)
          }
        },
      },

      ImportDeclaration(path, state) {
      },

      ExportDefaultDeclaration(path, state) {
        const { declaration } = path.node

        if (t.isClassDeclaration(declaration)) {
          classType = CLASS_TYPES.CLASS
          processClassComponent(path, state)
        } else if (t.isArrowFunctionExpression(declaration)) {
          classType = CLASS_TYPES.STATELESS_FUNCTION
          processStatelessComponent(path, state)
        }
      },

      ExportNamedDeclaration(path, state) {
        const declaration = path.node.declaration

        if (t.isClassDeclaration(declaration)) {
          classType = CLASS_TYPES.CLASS
          processClassComponent(path, state)
        } else if (t.isVariableDeclaration(declaration)) {
          classType = CLASS_TYPES.STATELESS_FUNCTION
          processStatelessComponent(path, state)
        }
      },

      JSXOpeningElement(path, state) {
        const {file, opts} = state
        const name = path.get('name')

        if (name.referencesImport(DEFAULT_REACT_INTL_SOURCE_NAME, 'FormattedPlural')) {
          file.log.warn(
            `[React Intl] Line ${path.node.loc.start.line}: ` +
            'Default messages are not extracted from ' +
            '<FormattedPlural>, use <FormattedMessage> instead.'
          )

          return
        }

        if (referencesImport(name, DEFAULT_REACT_INTL_SOURCE_NAME, COMPONENT_NAMES)) {
          let attributes = path.get('attributes')
          const idAttribute = getJSXAttributeById(path, 'id')
          const descriptionAttribute = getJSXAttributeById(path, 'description')

          if (!idAttribute) {
            // Supported JSX tag without 'id' attribute will be ignored.
            return
          }

          // Adds 'defaultMessage' attribute to JSX tag.
          path.node.attributes.push(
            t.jSXAttribute(
              t.jSXIdentifier('defaultMessage'),   // name
              t.stringLiteral(idAttribute.node.value.value)   // value
            )
          )

          const id = idAttribute.node.value.value
          const description = descriptionAttribute ? descriptionAttribute.node.value.value : null

          // @todo Validate.
          storeMessage({id, description}, path, state)
        }
      },

      CallExpression(path, state) {
        const callee = path.get('callee')

        if (referencesImport(callee, DEFINE_MESSAGES_MODULE_SOURCE_NAME, [DEFINE_MESSAGES_FUNCTION_NAME])) {
          consoleLog('  > Static definitions found!')
          const args = path.node.arguments

          if (args.length === 0) {
            throw path.buildCodeFrameError(
              `[React Intl] defineMessages has exactly one argument.`
            )
          }

          const messagesObj = head(args)
          if (!t.isObjectExpression(messagesObj)) {
            throw path.buildCodeFrameError(
              `[React Intl] defineMessages - Argument to this method must be object expression.`
            )
          }

          const {properties} = messagesObj
          properties.forEach(property => {
            const {id, description} = propertiesToObject(t, property.value.properties)

            storeMessage({id, description}, path, state)
          }, this)
        }

        if (referencesImport(callee, TRANSLATE_MODULE_SOURCE_NAME, [TRANSLATE_FUNCTION_NAME])) {
          const args = path.node.arguments

          const stringValue = getStringFromExpression(t, args[0])
          args[0] = t.stringLiteral(stringValue)

          // Automatically completes missing parameters.
          if (args.length < 2) {
            path.node.arguments.push(
              t.objectExpression([])
            )
          }

          if (args.length < 3) {
            path.node.arguments.push(
              t.nullLiteral()
            )
          }

          if (args.length < 4) {
            path.node.arguments.push(
              getPropVariable(path)
            )
          }

          path.replaceWith(
            t.callExpression(
              t.memberExpression(
                t.identifier('translate'),  // object
                t.identifier('call'),      // property
                false                       // computed
              ), // callee
              [
                t.thisExpression()
              ].concat(args)
            )
          )

          const id = args[0].value
          const description = !t.isNullLiteral(args[2]) ? args[2].value : null

          // @todo Add validations.
          if (id) {
            storeMessage({id, description}, path, state)
          }
        }
      },
    },
  }
}
