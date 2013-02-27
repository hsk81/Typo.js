'use strict';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

var Typo = function (dictionary, affData, wordsData, settings) {
    settings = settings || {};

    this.dictionary = null;
    this.rules = {};
    this.dictionaryTable = {};
    this.compoundRules = [];
    this.compoundRuleCodes = {};
    this.replacementTable = [];
    this.flags = settings.flags || {};

    if (dictionary) {
        this.dictionary = dictionary;

        var path = settings.dictionaryPath || '';
        if (!affData) affData = this._readFile(
            path + "/" + dictionary + "/" + dictionary + ".aff");
        if (!wordsData) wordsData = this._readFile(
            path + "/" + dictionary + "/" + dictionary + ".dic");

        this.rules = this._parseAFF(affData);
        this.compoundRuleCodes = {};

        for (var i = 0, _len = this.compoundRules.length; i < _len; i++) {
            var rule = this.compoundRules[i];
            for (var j = 0, _jlen = rule.length; j < _jlen; j++) {
                this.compoundRuleCodes[rule[j]] = [];
            }
        }

        // If we add this ONLYINCOMPOUND flag to this.compoundRuleCodes, then _parseDIC
        // will do the work of saving the list of words that are compound-only.
        if ("ONLYINCOMPOUND" in this.flags) {
            this.compoundRuleCodes[this.flags.ONLYINCOMPOUND] = [];
        }

        this.dictionaryTable = this._parseDIC(wordsData);

        // Get rid of any codes from the compound rule codes that are never used
        // (or that were special regex characters).  Not especially necessary...
        for (var i in this.compoundRuleCodes) {
            if (this.compoundRuleCodes[i].length == 0) {
                delete this.compoundRuleCodes[i];
            }
        }

        // Build the full regular expressions for each compound rule.
        // I have a feeling (but no confirmation yet) that this method of
        // testing for compound words is probably slow.
        for (var i = 0, _len = this.compoundRules.length; i < _len; i++) {
            var ruleText = this.compoundRules[i];
            var expressionText = "";

            for (var j = 0, _jlen = ruleText.length; j < _jlen; j++) {
                var character = ruleText[j];

                if (character in this.compoundRuleCodes)
                    expressionText += "(" + this.compoundRuleCodes[character].join("|") + ")";
                else
                    expressionText += character;
            }

            this.compoundRules[i] = new RegExp(expressionText, "i");
        }
    }

    return this;
};

Typo.prototype = {

    _readFile: function (path, charset) {
        if (!charset) charset = "ISO8859-1";

        var req = new XMLHttpRequest();
        req.open("GET", path, false);
        req.overrideMimeType("text/plain; charset=" + charset);
        req.send(null);

        return req.responseText;
    },

    _parseAFF: function (data) {
        var rules = {};

        // Remove comment lines
        data = this._removeAffixComments(data);

        var lines = data.split("\n");

        for (var i = 0, _len = lines.length; i < _len; i++) {
            var line = lines[i];

            var definitionParts = line.split(/\s+/);

            var ruleType = definitionParts[0];

            if (ruleType == "PFX" || ruleType == "SFX") {
                var ruleCode = definitionParts[1];
                var combineable = definitionParts[2];
                var numEntries = parseInt(definitionParts[3], 10);

                var entries = [];

                for (var j = i + 1, _jlen = i + 1 + numEntries; j < _jlen; j++) {
                    var line = lines[j];

                    var lineParts = line.split(/\s+/);
                    var charactersToRemove = lineParts[2];

                    var additionParts = lineParts[3].split("/");

                    var charactersToAdd = additionParts[0];
                    if (charactersToAdd === "0") charactersToAdd = "";

                    var continuationClasses = this.parseRuleCodes(additionParts[1]);

                    var regexToMatch = lineParts[4];

                    var entry = {};
                    entry.add = charactersToAdd;

                    if (continuationClasses.length > 0) entry.continuationClasses = continuationClasses;

                    if (regexToMatch !== ".") {
                        if (ruleType === "SFX") {
                            entry.match = new RegExp(regexToMatch + "$");
                        }
                        else {
                            entry.match = new RegExp("^" + regexToMatch);
                        }
                    }

                    if (charactersToRemove != "0") {
                        if (ruleType === "SFX") {
                            entry.remove = new RegExp(charactersToRemove + "$");
                        }
                        else {
                            entry.remove = charactersToRemove;
                        }
                    }

                    entries.push(entry);
                }

                rules[ruleCode] = { "type": ruleType, "combineable": (combineable == "Y"), "entries": entries };

                i += numEntries;
            }
            else if (ruleType === "COMPOUNDRULE") {
                var numEntries = parseInt(definitionParts[1], 10);

                for (var j = i + 1, _jlen = i + 1 + numEntries; j < _jlen; j++) {
                    var line = lines[j];

                    var lineParts = line.split(/\s+/);
                    this.compoundRules.push(lineParts[1]);
                }

                i += numEntries;
            }
            else if (ruleType === "REP") {
                var lineParts = line.split(/\s+/);

                if (lineParts.length === 3) {
                    this.replacementTable.push([ lineParts[1], lineParts[2] ]);
                }
            }
            else {
                // ONLYINCOMPOUND
                // COMPOUNDMIN
                // FLAG
                // KEEPCASE
                // NEEDAFFIX

                this.flags[ruleType] = definitionParts[1];
            }
        }

        return rules;
    },

    _removeAffixComments: function (data) {

        // Remove comments
        data = data.replace(/#.*$/mg, "");
        // Trim each line
        data = data.replace(/^\s\s*/m, '').replace(/\s\s*$/m, '');
        // Remove blank lines.
        data = data.replace(/\n{2,}/g, "\n");
        // Trim the entire string
        data = data.replace(/^\s\s*/, '').replace(/\s\s*$/, '');

        return data;
    },

    _parseDIC: function (data) {
        data = this._removeDicComments(data);

        var lines = data.split("\n");
        var dictionaryTable = {};

        // The first line is the number of words in the dictionary.
        for (var i = 1, _len = lines.length; i < _len; i++) {
            var line = lines[i];

            var parts = line.split("/", 2);

            var word = parts[0];

            // Now for each affix rule, generate that form of the word.
            if (parts.length > 1) {
                var ruleCodesArray = this.parseRuleCodes(parts[1]);

                // Save the ruleCodes for compound word situations.
                if (!("NEEDAFFIX" in this.flags) || ruleCodesArray.indexOf(this.flags.NEEDAFFIX) == -1) {
                    dictionaryTable[word] = ruleCodesArray;
                }

                for (var j = 0, _jlen = ruleCodesArray.length; j < _jlen; j++) {
                    var code = ruleCodesArray[j];

                    var rule = this.rules[code];

                    if (rule) {
                        var newWords = this._applyRule(word, rule);

                        for (var ii = 0, _iilen = newWords.length; ii < _iilen; ii++) {
                            var newWord = newWords[ii];

                            dictionaryTable[newWord] = "";

                            if (rule.combineable) {
                                for (var k = j + 1; k < _jlen; k++) {
                                    var combineCode = ruleCodesArray[k];

                                    var combineRule = this.rules[combineCode];

                                    if (combineRule) {
                                        if (combineRule.combineable && (rule.type != combineRule.type)) {
                                            var otherNewWords = this._applyRule(newWord, combineRule);

                                            for (var iii = 0, _iiilen = otherNewWords.length; iii < _iiilen; iii++) {
                                                var otherNewWord = otherNewWords[iii];
                                                dictionaryTable[otherNewWord] = "";
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (code in this.compoundRuleCodes) {
                        this.compoundRuleCodes[code].push(word);
                    }
                }
            }
            else {
                dictionaryTable[word] = "";
            }
        }

        return dictionaryTable;
    },

    _removeDicComments: function (data) {

        // Remove comments
        data = data.replace(/^\t.*$/mg, "");
        // Trim each line
        data = data.replace(/^\s\s*/m, '').replace(/\s\s*$/m, '');
        // Remove blank lines.
        data = data.replace(/\n{2,}/g, "\n");
        // Trim the entire string
        data = data.replace(/^\s\s*/, '').replace(/\s\s*$/, '');

        return data;
    },

    parseRuleCodes: function (textCodes) {
        if (!textCodes) {
            return [];
        }
        else if (!("FLAG" in this.flags)) {
            return textCodes.split("");
        }
        else if (this.flags.FLAG === "long") {
            var flags = [];

            for (var i = 0, _len = textCodes.length; i < _len; i += 2) {
                flags.push(textCodes.substr(i, 2));
            }

            return flags;
        }
        else if (this.flags.FLAG === "num") {
            return textCode.split(",");
        }
    },

    _applyRule: function (word, rule) {
        var entries = rule.entries;
        var newWords = [];

        for (var i = 0, _len = entries.length; i < _len; i++) {
            var entry = entries[i];

            if (!entry.match || word.match(entry.match)) {
                var newWord = word;

                if (entry.remove) {
                    newWord = newWord.replace(entry.remove, "");
                }

                if (rule.type === "SFX") {
                    newWord = newWord + entry.add;
                }
                else {
                    newWord = entry.add + newWord;
                }

                newWords.push(newWord);

                if ("continuationClasses" in entry) {
                    for (var j = 0, _jlen = entry.continuationClasses.length; j < _jlen; j++) {
                        var continuationRule = this.rules[entry.continuationClasses[j]];
                        if (continuationRule) {
                            newWords = newWords.concat(this._applyRule(newWord, continuationRule));
                        }
                    }
                }
            }
        }

        return newWords;
    },

    check: function (aWord) {
        // Remove leading and trailing whitespace
        var trimmedWord = aWord.replace(/^\s\s*/, '').replace(/\s\s*$/, '');

        if (this.checkExact(trimmedWord)) {
            return true;
        }

        // The exact word is not in the dictionary.
        if (trimmedWord.toUpperCase() === trimmedWord) {
            // The word was supplied in all uppercase.
            // Check for a capitalized form of the word.
            var capitalizedWord = trimmedWord[0] + trimmedWord.substring(1).toLowerCase();

            if (this.hasFlag(capitalizedWord, "KEEPCASE")) {
                // Capitalization variants are not allowed for this word.
                return false;
            }

            if (this.checkExact(capitalizedWord)) {
                return true;
            }
        }

        var lowercaseWord = trimmedWord.toLowerCase();

        if (lowercaseWord !== trimmedWord) {
            if (this.hasFlag(lowercaseWord, "KEEPCASE")) {
                // Capitalization variants are not allowed for this word.
                return false;
            }

            // Check for a lowercase form
            if (this.checkExact(lowercaseWord)) {
                return true;
            }
        }

        return false;
    },

    checkExact: function (word) {
        var ruleCodes = this.dictionaryTable[word];

        if (typeof ruleCodes === 'undefined') {
            // Check if this might be a compound word.
            if ("COMPOUNDMIN" in this.flags && word.length >= this.flags.COMPOUNDMIN) {
                for (var i = 0, _len = this.compoundRules.length; i < _len; i++) {
                    if (word.match(this.compoundRules[i])) {
                        return true;
                    }
                }
            }

            return false;
        }
        else {
            if (this.hasFlag(word, "ONLYINCOMPOUND")) {
                return false;
            }

            return true;
        }
    },

    hasFlag: function (word, flag) {
        if (flag in this.flags) {
            var wordFlags = this.dictionaryTable[word];

            if (wordFlags && wordFlags.indexOf(this.flags[flag]) !== -1) {
                return true;
            }
        }

        return false;
    }
};
