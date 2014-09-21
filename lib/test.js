var fs = require('fs');
var filter = function(s_text) {
	return (s_text+'')
		 .replace(/\([A-Z][^\)]+\d{4}\)/g, '')
		.replace(/\d+( [^\n]*http:\/\/[^\n]+[^\n]*)?\r?\n/g, '')
		.replace(/http:\/\/[^ \n]/g, '. URL removed.')
		.replace(/\nReferences\r?\n[^]+$/, '');
};

var s_pdf = fs.readFileSync('./sample.txt', 'utf8');
// console.log(s_pdf);
var s_good = filter(s_pdf);

console.log(s_good);