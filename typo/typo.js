'use strict';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

var Typo = function (lingua, aff_data, dic_data, settings) {
    settings = settings || {};

    this.lingua = lingua;
    this.rules = {};
    this.lookup_tbl = {};
    this.CRs = [];
    this.CRCs = {};
    this.ersatz_tbl = [];
    this.flags = settings.flags || {};

    if (!this.lingua) {
        return this;
    }

    var path = settings.path || '';
    if (!aff_data) aff_data = this.read_file(
        path + "/" + lingua + "/" + lingua + ".aff");
    if (!dic_data) dic_data = this.read_file(
        path + "/" + lingua + "/" + lingua + ".dic");

    this.rules = this.aff_parse(aff_data);
    this.CRCs = {};

    for (var i=0, _len=this.CRs.length; i<_len; i++) {
        var rule = this.CRs[i];
        for (var j=0, _jlen=rule.length; j<_jlen; j++) {
            this.CRCs[rule[j]] = [];
        }
    }

    // If we add this ONLYINCOMPOUND flag to this.CRCs, then `dic_parse`
    // will do the work of saving the list of words that are compound-only.
    if ("ONLYINCOMPOUND" in this.flags) {
        this.CRCs[this.flags.ONLYINCOMPOUND] = [];
    }

    this.lookup_tbl = this.dic_parse(dic_data);

    // Get rid of any codes from the CRCs that are never used (or that were
    // special regex characters). Not especially necessary ..
    for (var i in this.CRCs) {
        if (this.CRCs[i].length == 0) delete this.CRCs[i];
    }

    // Build the full regular expressions for each compound rule. I've a
    // feeling (but no confirmation yet) that this method of testing for
    // compound words is probably *slow*!
    for (var i=0, _len=this.CRs.length; i<_len; i++) {

        var rule_text = this.CRs[i];
        var expr_text = "";

        for (var j=0, _jlen=rule_text.length; j<_jlen; j++) {
            var ch = rule_text[j];
            if (ch in this.CRCs)
                expr_text += "(" + this.CRCs[ch].join("|") + ")";
            else
                expr_text += ch;
        }

        this.CRs[i] = new RegExp(expr_text, "i");
    }

    return this;
};

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

Typo.prototype = {

    load: function (object) {
        for (var key in object) {
            if (object.hasOwnProperty (key)) this[key] = object[key];
        } return this;
    },

    read_file: function (path, charset) {
        if (!charset) charset = "ISO8859-1";

        var xhr = new XMLHttpRequest();
        xhr.open("GET", path, false);
        xhr.overrideMimeType("text/plain; charset=" + charset);
        xhr.send(null);

        return (xhr.status == 200) ? xhr.responseText : null;
    },

    ///////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////

    aff_parse: function (data) {

        var rules = {};
        data = this.aff_clean(data);
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

                for (var j=i+1, _jlen=i+1+numEntries; j<_jlen; j++) {

                    var line = lines[j];
                    var lineParts = line.split(/\s+/);
                    var charactersToRemove = lineParts[2];
                    var additionParts = lineParts[3].split("/");
                    var charactersToAdd = additionParts[0];
                    if (charactersToAdd === "0") charactersToAdd = "";

                    var cont_cls = this.parse_rcs(additionParts[1]);
                    var regexToMatch = lineParts[4];
                    var entry = {add: charactersToAdd};

                    if (cont_cls.length > 0) {
                        entry.continuationClasses = cont_cls;
                    }

                    if (regexToMatch !== ".") {
                        if (ruleType === "SFX") {
                            entry.match = new RegExp(regexToMatch + "$");
                        } else {
                            entry.match = new RegExp("^" + regexToMatch);
                        }
                    }

                    if (charactersToRemove != "0") {
                        if (ruleType === "SFX") {
                            entry.remove = new RegExp(charactersToRemove+"$");
                        } else {
                            entry.remove = charactersToRemove;
                        }
                    }

                    entries.push(entry);
                }

                rules[ruleCode] = {
                    "type": ruleType,
                    "combineable": (combineable == "Y"),
                    "entries": entries
                };

                i += numEntries;
            } else

            if (ruleType === "COMPOUNDRULE") {
                var numEntries = parseInt(definitionParts[1], 10);

                for (var j=i+1, _jlen=i+1+numEntries; j<_jlen; j++) {
                    var line = lines[j];
                    var lineParts = line.split(/\s+/);
                    this.CRs.push(lineParts[1]);
                }

                i += numEntries;
            } else

            if (ruleType === "REP") {
                var lineParts = line.split(/\s+/);
                if (lineParts.length === 3) {
                    this.ersatz_tbl.push([ lineParts[1], lineParts[2] ]);
                }
            }

            else { // ONLYINCOMPOUND, COMPOUNDMIN, FLAG, KEEPCASE, NEEDAFFIX
                this.flags[ruleType] = definitionParts[1];
            }
        }

        return rules;
    },

    aff_clean: function (data) {

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

    ///////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////

    dic_parse: function (data) {
        data = this.dic_clean(data);

        var lines = data.split("\n");
        var dictionaryTable = {};

        // The first line is the number of words in the dictionary.
        for (var i = 1, _len = lines.length; i < _len; i++) {
            var line = lines[i];

            var parts = line.split("/", 2);

            var word = parts[0];

            // Now for each affix rule, generate that form of the word.
            if (parts.length > 1) {
                var ruleCodesArray = this.parse_rcs(parts[1]);

                // Save the ruleCodes for compound word situations.
                if (!("NEEDAFFIX" in this.flags) ||
                    ruleCodesArray.indexOf(this.flags.NEEDAFFIX) == -1) {
                    dictionaryTable[word] = ruleCodesArray;
                }

                for (var j=0, _jlen=ruleCodesArray.length; j<_jlen; j++) {

                    var code = ruleCodesArray[j];
                    var rule = this.rules[code];
                    if (rule) {

                        var newWords = this.apply_rule(word, rule);

                        for (var ii=0, _iilen=newWords.length; ii<_iilen; ii++) {

                            var newWord = newWords[ii];
                            dictionaryTable[newWord] = "";

                            if (rule.combineable) {
                                for (var k = j + 1; k < _jlen; k++) {

                                    var combineCode = ruleCodesArray[k];
                                    var combineRule = this.rules[combineCode];
                                    if (combineRule) {
                                        if (combineRule.combineable &&
                                            (rule.type != combineRule.type)) {

                                            var otherNewWords = this.apply_rule(newWord, combineRule);

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

                    if (code in this.CRCs) {
                        this.CRCs[code].push(word);
                    }
                }
            } else {
                dictionaryTable[word] = "";
            }
        }

        return dictionaryTable;
    },

    dic_clean: function (data) {

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

    apply_rule: function (word, rule) {
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
                } else {
                    newWord = entry.add + newWord;
                }

                newWords.push(newWord);

                if ("continuationClasses" in entry) {
                    for (var j=0, _jlen=entry.continuationClasses.length; j<_jlen; j++) {
                        var continuationRule = this.rules[entry.continuationClasses[j]];
                        if (continuationRule) {
                            newWords = newWords.concat(this.apply_rule(newWord, continuationRule));
                        }
                    }
                }
            }
        }

        return newWords;
    },

    ///////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////

    parse_rcs: function (text_codes) {
        if (!text_codes) {
            return [];
        } else if (!("FLAG" in this.flags)) {
            return text_codes.split("");
        } else if (this.flags.FLAG === "long") {
            var flags = [];
            for (var i=0, _len=text_codes.length; i<_len; i += 2) {
                flags.push(text_codes.substr(i, 2));
            } return flags;
        } else if (this.flags.FLAG === "num") {
            return text_codes.split(",");
        }
    },

    ///////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////

    check: function (word) {
        var trimmed = word.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
        if (this.check_exact(trimmed)) return true;

        if (trimmed.toUpperCase() === trimmed) {
            var capitalized = trimmed[0] + trimmed.substring(1).toLowerCase();
            if (this.has_flag(capitalized, "KEEPCASE")) return false;
            if (this.check_exact(capitalized)) return true;
        }

        var lowercase = trimmed.toLowerCase();
        if (lowercase !== trimmed) {
            if (this.has_flag(lowercase, "KEEPCASE")) return false;
            if (this.check_exact(lowercase)) return true;
        }

        return false;
    },

    check_exact: function (word) {
        var rule_codes = this.lookup_tbl[word];
        if (typeof rule_codes === 'undefined') {
            return this.compound_min (word);
        } else {
            return (!this.has_flag(word, "ONLYINCOMPOUND"));
        }
    },

    compound_min: function (word) {

        if ("COMPOUNDMIN" in this.flags &&
            word.length >= this.flags.COMPOUNDMIN) {
            for (var i = 0, _len = this.CRs.length; i < _len; i++) {
                if (word.match(this.CRs[i])) return true;
            }
        }

        return false;
    },

    has_flag: function (word, flag) {

        if (flag in this.flags) {
            var wordFlags = this.lookup_tbl[word]; return (wordFlags &&
                wordFlags.indexOf(this.flags[flag]) !== -1
            );
        }

        return false;
    }
};

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
