Typo.js is a JavaScript spellchecker that uses Hunspell-style dictionaries. Its main use is to allow Chrome extensions to perform client-side spellchecking.

Usage
=====

To use Typo, simply include the typo.js file in your extension's background page, and then initialize the dictionary like so:

```javascript
var dictionary = new Typo("en_US");
```

To check if a word is spelled correctly, do this:

```javascript
var is_spelled_correctly = dictionary.check("mispelled");
```

Typo.js has full support for the following Hunspell affix flags:

* PFX
* SFX
* REP
* FLAG
* COMPOUNDMIN
* COMPOUNDRULE
* ONLYINCOMPOUND
* KEEPCASE
* NOSUGGEST
* NEEDAFFIX

Licensing
=========

Typo.js is free software, licensed under the Modified BSD License.
