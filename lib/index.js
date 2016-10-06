'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _stringify = require('babel-runtime/core-js/json/stringify');

var _stringify2 = _interopRequireDefault(_stringify);

var _toConsumableArray2 = require('babel-runtime/helpers/toConsumableArray');

var _toConsumableArray3 = _interopRequireDefault(_toConsumableArray2);

var _map = require('babel-runtime/core-js/map');

var _map2 = _interopRequireDefault(_map);

var _set = require('babel-runtime/core-js/set');

var _set2 = _interopRequireDefault(_set);

exports.default = function (_ref) {
    var t = _ref.types;


    function storeMessage(_ref2, path, state) {
        var id = _ref2.id;
        var description = _ref2.description;
        var opts = state.opts;
        var reactIntl = state.reactIntl;


        if (!id) {
            throw path.buildCodeFrameError('[React Intl] Message Descriptors require an `id` attribute.');
        }

        if (reactIntl.messages.has(id)) {
            var existing = reactIntl.messages.get(id);

            if (description !== existing.description) {
                throw path.buildCodeFrameError('[React Intl] Duplicate message id: "' + id + '", ' + 'but the `description` are different.');
            }
        }

        if (opts.enforceDescriptions && !description) {
            throw path.buildCodeFrameError('[React Intl] Message must have a `description`.');
        }

        reactIntl.messages.set(id, { id: id, description: description });
    }

    function customReferencesImport(moduleSource, importName, sourcePathNormalizer) {
        if (!this.isReferencedIdentifier()) {
            return false;
        }

        var binding = this.scope.getBinding(this.node.name);
        if (!binding || binding.kind !== "module") {
            return false;
        }

        var path = binding.path;

        var parent = path.parentPath;

        if (!parent.isImportDeclaration()) {
            return false;
        }

        var normalizedSource = sourcePathNormalizer ? sourcePathNormalizer(parent.node.source.value) : parent.node.source.value;

        if (normalizedSource === moduleSource) {
            if (!importName) {
                return true;
            }
        } else {
            return false;
        }

        if (path.isImportDefaultSpecifier() && importName === "default") {
            return true;
        }

        if (path.isImportNamespaceSpecifier() && importName === "*") {
            return true;
        }

        if (path.isImportSpecifier() && path.node.imported.name === importName) {
            return true;
        }

        return false;
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
        var aliases = ['skybase-components', 'skybase-core', 'skybase-shell', 'skybase-styling'];
        var result = sourcePath;

        aliases.forEach(function (alias) {
            result = result.replace(new RegExp('^.*?' + alias), alias);
        });

        return result;
    }

    function referencesImport(path, mod, importedNames) {
        if (!(path.isIdentifier() || path.isJSXIdentifier())) {
            return false;
        }

        return importedNames.some(function (name) {
            return customReferencesImport.apply(path, [mod, name, normalizer]);
        });
    }

    function isSuperClassSupported(superClass) {
        if (t.isMemberExpression(superClass)) {
            if (superClass.object.name === 'React' && superClass.property.name === 'Component') {
                return true;
            }
        }

        if (t.isIdentifier(superClass)) {
            var name = superClass.name;
            // @todo Check if 'Component' is imported from react package.

            if ((0, _lodash.includes)(['Component', 'SbBaseComponent'], name)) {
                return true;
            }
        }

        return false;
    }

    function processClassComponent(path, state) {
        var declaration = path.node.declaration;

        if (!declaration.id) {
            // @todo Support also 'export default class'..
            return;
        }

        var className = declaration.id.name;
        var newClassName = '_' + className;

        // We can't inject react-intl into our base component, it's used for extending other (injected) classes.
        if (className === 'SbBaseComponent') {
            return;
        }

        consoleLog('  > Object:', className.yellow);

        var superClass = declaration.superClass;

        if (!superClass) {
            consoleLog('    > Ignored:', 'Has no superclass.');
            return;
        }

        // @todo Very naive implementation, handle also extends of React.Component
        if (!isSuperClassSupported(superClass)) {
            consoleLog('    > Ignored:', 'Is not extending supported superclass.');
            return;
        }

        if ((0, _lodash.includes)(convertedClassNames, className)) {
            return;
        }

        convertedClassNames.push(newClassName);
        consoleLog('    > Injected!'.green);

        path.node.declaration.id.name = newClassName;

        if (!importSet) {
            path.insertBefore(t.importDeclaration([t.importSpecifier(t.identifier('injectIntl'), // local
              t.identifier('injectIntl') // imported
            )], t.stringLiteral(DEFAULT_REACT_INTL_SOURCE_NAME)));

            importSet = true;
        }

        // @todo Refactor! It's located here twice!
        path.insertAfter(t.exportNamedDeclaration(t.variableDeclaration('const', // kind
          [t.variableDeclarator(t.identifier(className), t.callExpression(t.identifier('injectIntl'), [t.identifier(newClassName)]))]), // declaration
          [], // specifiers
          null // source (StringLiteral)
        ));
    }

    function isReactComponent(path) {
        var declarations = path.node.declaration.declarations;
        if (!declarations) {
            return false;
        }

        var name = declarations[0].id.name;

        var init = declarations[0].init;

        consoleLog('  > Object:', name.yellow);

        // If the first letter of function is capital, then we consider it as a react component.
        // First, check first letter of name is capital.
        if (name[0] !== name[0].toUpperCase()) {
            consoleLog('    > Ignored:'.grey, 'Is not camelcase'.grey);
            return false;
        }

        // then, init part must be an arrow function.
        if (!t.isArrowFunctionExpression(init)) {
            consoleLog('    > Ignored:'.grey, 'Is not arrow function'.grey);
            return false;
        }

        var body = init.body;
        // @todo support also JSX no-return (arrow) statement, .e.g. const x = () => (<p>hello</p>)

        if (!t.isBlockStatement(body)) {
            consoleLog('    > Ignored:'.grey, 'Has no block statement'.grey);
            return;
        }

        var blockBody = body.body;
        var lastStatement = (0, _lodash.last)(blockBody);

        if (!t.isReturnStatement(lastStatement)) {
            // @todo Support more returns, e.g. if (1==1) { return (<p>X</p>) } else { return (<p>Y</p>) }
            consoleLog('    > Ignored:'.grey, 'Has no return statement at the end.'.grey);
            return false;
        }

        return t.isJSXElement(lastStatement.argument);
    }

    function processStatelessComponent(path, state) {
        if (!isReactComponent(path)) {
            return;
        }

        var funcDeclaration = path.node.declaration.declarations[0];
        var className = funcDeclaration.id.name;
        var newClassName = '_' + className;

        if ((0, _lodash.includes)(convertedClassNames, className)) {
            return;
        }

        convertedClassNames.push(newClassName);
        convertedClassNames.push(className);

        funcDeclaration.id.name = newClassName;

        path.replaceWith(t.exportNamedDeclaration(t.variableDeclaration('const', // kind
          [funcDeclaration]), // declaration
          [], // specifiers
          null // source (StringLiteral)
        ));

        consoleLog('    > Injected!'.green);

        if (!importSet) {
            path.insertBefore(t.importDeclaration([t.importSpecifier(t.identifier('injectIntl'), // local
              t.identifier('injectIntl') // imported
            )], t.stringLiteral(DEFAULT_REACT_INTL_SOURCE_NAME)));

            importSet = true;
        }

        path.insertAfter(t.exportNamedDeclaration(t.variableDeclaration('const', // kind
          [t.variableDeclarator(t.identifier(className), t.callExpression(t.identifier('injectIntl'), [t.identifier(newClassName)]))]), // declaration
          [], // specifiers
          null // source (StringLiteral)
        ));
    }

    function getJSXAttributeById(path, id) {
        var attributes = path.get('attributes');
        var attribute = attributes.filter(function (attr) {
            return t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.node.name) && attr.node.name.name === id;
        });

        return attribute ? (0, _lodash.head)(attribute) : null;
    }

    // @todo Implement some smart detection of props variable.
    function getPropVariable(path) {
        var thisProps = t.memberExpression(t.thisExpression(), t.identifier('props.intl.formatMessage'), false); // result: this.props

        return classType == CLASS_TYPES.CLASS ? thisProps : t.identifier('typeof props != \'undefined\' ? props.intl.formatMessage : null');
    }

    function propertiesToObject(properties) {
        var result = {};

        properties.forEach(function (property) {
            var name = property.key.name;
            var value = property.value.value;


            result[name] = value;
        });

        return result;
    }

    function consoleLog() {
        if (developmentMode) {
            var args = Array.prototype.slice.call(arguments);
            console.log.apply(this, args);
        }
    }

    return {
        visitor: {
            Program: {
                enter: function enter(path, state) {
                    var file = state.file;
                    var opts = state.opts;
                    var _file$opts = file.opts;
                    var basename = _file$opts.basename;
                    var filename = _file$opts.filename;


                    consoleLog('>', filename);

                    state.reactIntl = {
                        messages: new _map2.default()
                    };

                    importSet = false;
                    convertedClassNames = [];
                },
                exit: function exit(path, state) {
                    var file = state.file;
                    var opts = state.opts;
                    var reactIntl = state.reactIntl;
                    var _file$opts2 = file.opts;
                    var basename = _file$opts2.basename;
                    var filename = _file$opts2.filename;

                    var descriptors = [].concat((0, _toConsumableArray3.default)(reactIntl.messages.values()));

                    file.metadata['react-intl'] = { messages: descriptors };

                    if (!opts.messagesDir) {
                        return;
                    }

                    if (opts.messagesDir && descriptors.length > 0) {
                        // Make sure the relative path is "absolute" before
                        // joining it with the `messagesDir`.
                        var relativePath = p.join(p.sep, p.relative(process.cwd(), filename));

                        var messagesFilename = p.join(opts.messagesDir, p.dirname(relativePath), basename + '.json');

                        var normalizedMessages = descriptors.map(function (message) {
                            if (message.description == null) {
                                delete message['description'];
                            }

                            return message;
                        })
                        // Sort message alphabetically by 'id' attribute.
                          .sort(function (a, b) {
                              a = a.id.toLowerCase();
                              b = b.id.toLowerCase();

                              if (a > b) {
                                  return 1;
                              } else if (a < b) {
                                  return -1;
                              } else {
                                  return 0;
                              }
                          });

                        var messagesFile = (0, _stringify2.default)(normalizedMessages, null, 2);

                        (0, _mkdirp.sync)(p.dirname(messagesFilename));
                        (0, _fs.writeFileSync)(messagesFilename, messagesFile);
                    }
                }
            },

            ImportDeclaration: function ImportDeclaration(path, state) {},
            ExportDeclaration: function ExportDeclaration(path, state) {
                // @todo Implement!
            },
            ExportNamedDeclaration: function ExportNamedDeclaration(path, state) {
                var declaration = path.node.declaration;

                if (t.isClassDeclaration(declaration)) {
                    classType = CLASS_TYPES.CLASS;
                    processClassComponent(path, state);
                } else if (t.isVariableDeclaration(declaration)) {
                    classType = CLASS_TYPES.STATELESS_FUNCTION;
                    processStatelessComponent(path, state);
                }
            },
            JSXOpeningElement: function JSXOpeningElement(path, state) {
                var file = state.file;
                var opts = state.opts;

                var name = path.get('name');

                if (name.referencesImport(DEFAULT_REACT_INTL_SOURCE_NAME, 'FormattedPlural')) {
                    file.log.warn('[React Intl] Line ' + path.node.loc.start.line + ': ' + 'Default messages are not extracted from ' + '<FormattedPlural>, use <FormattedMessage> instead.');

                    return;
                }

                if (referencesImport(name, DEFAULT_REACT_INTL_SOURCE_NAME, COMPONENT_NAMES)) {
                    var attributes = path.get('attributes');
                    var idAttribute = getJSXAttributeById(path, 'id');
                    var descriptionAttribute = getJSXAttributeById(path, 'description');

                    if (!idAttribute) {
                        // Supported JSX tag without 'id' attribute will be ignored.
                        return;
                    }

                    // Adds 'defaultMessage' attribute to JSX tag.
                    path.node.attributes.push(t.jSXAttribute(t.jSXIdentifier('defaultMessage'), // name
                      t.stringLiteral(idAttribute.node.value.value) // value
                    ));

                    var id = idAttribute.node.value.value;
                    var description = descriptionAttribute ? descriptionAttribute.node.value.value : null;

                    // @todo Validate.
                    storeMessage({ id: id, description: description }, path, state);
                }
            },
            CallExpression: function CallExpression(path, state) {
                var callee = path.get('callee');

                if (referencesImport(callee, DEFINE_MESSAGES_MODULE_SOURCE_NAME, [DEFINE_MESSAGES_FUNCTION_NAME])) {
                    consoleLog('  > Static definitions found!');
                    var args = path.node.arguments;

                    if (args.length === 0) {
                        throw path.buildCodeFrameError('[React Intl] defineMessages has exactly one argument.');
                    }

                    var messagesObj = (0, _lodash.head)(args);
                    if (!t.isObjectExpression(messagesObj)) {
                        throw path.buildCodeFrameError('[React Intl] defineMessages - Argument to this method must be object expression.');
                    }

                    var properties = messagesObj.properties;

                    properties.forEach(function (property) {
                        var _propertiesToObject = propertiesToObject(property.value.properties);

                        var id = _propertiesToObject.id;
                        var description = _propertiesToObject.description;


                        storeMessage({ id: id, description: description }, path, state);
                    }, this);
                }

                if (referencesImport(callee, TRANSLATE_MODULE_SOURCE_NAME, [TRANSLATE_FUNCTION_NAME])) {
                    var _args = path.node.arguments;

                    // Automatically completes missing parameters.
                    if (_args.length < 2) {
                        path.node.arguments.push(t.objectExpression([]));
                    }

                    if (_args.length < 3) {
                        path.node.arguments.push(t.nullLiteral());
                    }

                    if (_args.length < 4) {
                        path.node.arguments.push(getPropVariable(path));
                    }

                    path.replaceWith(t.callExpression(t.memberExpression(t.identifier('translate'), // object
                      t.identifier('call'), // property
                      false // computed
                      ), // callee
                      [t.thisExpression()].concat(_args)));

                    var id = _args[0].value;
                    var description = !t.isNullLiteral(_args[2]) ? _args[2].value : null;

                    // @todo Add validations.
                    if (id) {
                        storeMessage({ id: id, description: description }, path, state);
                    }
                }
            }
        }
    };
};

var _path = require('path');

var p = _interopRequireWildcard(_path);

var _fs = require('fs');

var _mkdirp = require('mkdirp');

var _lodash = require('lodash');

var _printIcuMessage = require('./print-icu-message');

var _printIcuMessage2 = _interopRequireDefault(_printIcuMessage);

var _colors = require('colors');

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/*
 * Copyright 2015, Yahoo Inc.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

var COMPONENT_NAMES = ['FormattedMessage', 'FormattedHTMLMessage'];

var TRANSLATE_FUNCTION_NAME = 'translate';
var TRANSLATE_MODULE_SOURCE_NAME = 'skybase-core/utils/translate';

var DEFINE_MESSAGES_FUNCTION_NAME = 'defineMessages';
var DEFINE_MESSAGES_MODULE_SOURCE_NAME = 'skybase-core/utils/define-messages';

var DEFAULT_REACT_INTL_SOURCE_NAME = 'react-intl';
var DESCRIPTOR_PROPS = new _set2.default(['id', 'description']);

// @todo Move to plugin's internal state.
var importSet = false;
var convertedClassNames = [];

var CLASS_TYPES = {
    CLASS: 'CLASS',
    STATELESS_FUNCTION: 'STATELESS_FUNCTION'
};

var classType = null;

var developmentMode = process.env['NODE_ENV'] === 'development';

;