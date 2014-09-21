var child_process = require('child_process');
var exec = child_process.exec;
var spawn = child_process.spawn;
var request = require('request');
var fs = require('fs');
var mkdirp = require('mkdirp');

var pdf_ts = (function() {

	// declare base URI
	var S_URI = 'http://translate.google.com/translate_tts?tl=en&q=';

	// regexes
	var X_CITATION = /\([A-Z][^\)]+\d{4}\)/g;
	var X_REFERENCES = /\r?\n\f?References\r?\n\f?[^]+$/;
	var X_FOOTNOTE = /^\f?\d+(.*)$/mg;
	var X_PAGE_BREAK = /\n*\f+\n*/g;
	var X_LINES = /[\r\n\f]+/g;
	var X_AND = / and /g;
	var X_FRAGMENTS = /[,:;\(\)] /g;
	var X_SENTENCES = /[.!?][ \n]/g;
	var X_PARAGRAPHS = /<\+\!\+>/g;

	// durations to pause for
	var T_PAUSE_FRAGMENT = 175;
	var T_PAUSE_SENTENCE = 350;

	// constants
	var N_SAMPLE_RATE = 16000;
	var N_MAX_FILES_PER_PROCESS = 1000;

	// tones to insert for notification purposes
	var H_TONE_PARAGRAPH = {
		tone: 'sine-beep.wav',
	};

	// maximum character length
	var N_TTS_MAX = 100;

	// prepare an array to store all of the text chunks
	var a_chunks = [];
	var ap_chunks = [];
	var a_pending_chunks = [];

	// path to where the documents go (defaults to 'output')
	var p_library = __dirname+'/output';

	// path to the audios for this document
	var p_audios;

	// prepare to name this document (defaults to 'sample')
	var s_document = 'sample';


	// generate the path for a given chunk index
	var path_for_chunk = function(i_chunk, s_ext) {

		// default file extention
		s_ext = '.'+ (s_ext || 'mp3');

		// create the path name for this audio chunk
		var p_chunk = p_audios+'/'+('0000'+i_chunk).slice(-4)+'.'+s_ext;

		// save this path to the array
		ap_chunks[i_chunk] = p_chunk;

		// return path
		return p_chunk;
	};


	// clear chunk from queue
	var chunk_ready = function() {

		// get the index of the chunk index
		var i_i_chunk = a_pending_chunks.indexOf(i_chunk);

		// check it's actually there
		if(i_i_chunk == -1) return console.error('chunk is missing from queue: "'+a_chunks[i_chunk]+'"');

		// remove the chunk from the queue
		q_pending_chunks.splice(i_i_chunk, 1);
	};


	// helper generator for declaring a chunk is ready
	var declare_chunk_ready = function(i_chunk) {

		// argument wrapping
		return function() {
			chunk_ready(i_chunk);
		};
	};


	// process sound chunk
	var process_chunk = function(i_chunk) {

		// reference the chunk of unknown type
		var z_chunk = a_chunks[i_chunk];

		// pause silence
		if('number' == typeof z_chunk) {

			// convert duration to decimal seconds
			var n_duration_sec = (z_chunk / 1000);

			// generate a silence
			spawn('sox', ['-n', '-r', N_SAMPLE_RATE, path_for_chunk(i_chunk), 'trim', '0.0', n_duration_sec])
				.on('close', declare_chunk_ready(i_chunk));
		}
		// text-to-speech
		else if('string' == typeof z_chunk) {

			// reference the chunk of text
			var s_chunk = a_chunks[i_chunk];

			// make http request and save file
			var d_download = request(S_URI + s_chunk, declare_chunk_ready(i_chunk))
				.pipe(
					fs.createWriteStream(
						path_for_chunk(i_chunk)
					)
				);
		}
		// tone or clip
		else if('object' == typeof z_chunk) {

			// tone
			if(z_chunk.tone) {

				// copy the sound over
				var y_spawn = spawn('cp', ['./res/'+z_chunk.tone, path_for_chunk(i_chunk, 'wav')], {cwd:__dirname+'/../'});

				// when process is finished
				y_spawn.on('close', declare_chunk_ready(i_chunk));
			}
		}
	};


	// process all text
	var process_text = function() {

		// prepare the audio directory
		p_audios = p_library+'/'+s_document;

		// ensure dump directory exists
		mkdirp(p_audios, function(err) {

			//
			if(err) process.exit(1);

			// iterate all speakable chunks
			for(var i=0; i<a_chunks.length; i++) {

				// push index of each chunk to pending chunks queue
				a_pending_chunks.push(i);

				// process chunk
				process_chunk(i);
			}
		});
	};


	// removes things we don't need to hear
	var filter_paper = function(s_text) {

		// warn about whats being removed
		console.error('Removed the following text before converting to speech:');

		// remove shit
		while(m_citation=X_CITATION.exec(s_text)) {
			console.log('\tcitation: "'+m_citation[0].replace(X_LINES, '')+'"');
		}
		s_text = s_text.replace(X_CITATION, '');

		//
		while(m_footnote=X_FOOTNOTE.exec(s_text)) {
			console.log('\tfootnote: "'+m_footnote[0].replace(X_LINES, '')+'"');
		}
		s_text = s_text.replace(X_FOOTNOTE, '');

		// 
		if(m_references=X_REFERENCES.exec(s_text)) {
			console.log('\treference section: "'+m_references[0].replace(X_LINES,' ')+'"');
			s_text = s_text.replace(X_REFERENCES, '');
		}

		// replace page break with space
		s_text = s_text.replace(X_PAGE_BREAK, '')
			.replace(X_LINES, '.  <+!+>')
			.replace(/\s\s+/g, ' ')
			.replace(/^\s+|\s+$/, '');

		//
		return s_text;
	};


	// convert a pdf file to text
	var pdf_to_text = function(p_pdf, f_okay) {

		// execute conversion
		var d_convert = spawn('pdftotext', [p_pdf, '-'], {cwd: __dirname});
		var s_data = '';
		d_convert.stdout.on('data', function(s_chunk) {
			s_data += s_chunk;
		});
		d_convert.on('close', function() {
			f_okay && f_okay(s_data);
		});
	};


	// split words
	var split_words = function(s_words) {

		// prepare index marker
		var i_buffer = 0, s_buffer;

		// start a loop
		do {

			// prepare text buffer
			s_buffer = s_words.substr(i_buffer, 101);

			// find a good spot to cut off
			var i_limit = /(\W*\b\w+\W*)$/.exec(s_buffer).index;

			// advance the index
			i_buffer += i_limit;

			// construct final chunk of text
			s_chunk = s_buffer.substr(0, i_limit);

			// append it to the chunk queue
			s_chunk.length && a_chunks.push(s_chunk);

			// check buffer index
			if(i_buffer > s_words.length-N_TTS_MAX) {

				// push this chunk to the array
				s_push = s_words.substr(i_buffer);
				s_push.length && a_chunks.push(s_push);

				// done with loop
				break;
			}

		} while(true);
	};


	// split fragments
	var split_fragment = function(s_fragment) {

		// fragment is ready for google tts
		if(s_fragment.length <= N_TTS_MAX) {
			s_fragment.length && a_chunks.push(s_fragment);
		}
		// fragment needs to be broken down more
		else {

			// find "and"
			X_AND.lastIndex = 1;
			if(m_and=X_AND.exec(s_fragment)) {

				// store highest index we can get without going over max tts limit
				var i_and = m_and.index;

				// attempt to find all other "and"s
				while(m_and=X_AND.exec(s_fragment)) {

					// found another and before max point
					if(m_and.index < N_TTS_MAX+5) {
						i_and = m_and.index;
					}
				}

				// settle with the last and
				var s_chunk = s_fragment.substr(0, i_and);
				s_chunk.length && a_chunks.push(s_chunk);

				// recurse on rest of fragment
				split_fragment(s_fragment.substr(i_and));
			}

			// no "and"s :(
			else {

				// resort to words
				split_words(s_fragment);
			}
		}
	};

	// split sentence
	var split_sentence = function(s_sentence) {

		// comma-delimeters
		var a_fragments = s_sentence.split(X_FRAGMENTS);

		// iterate all fragments
		for(var i=0; i<a_fragments.length; i++) {

			// break down fragment if need be
			split_fragment(a_fragments[i]);

			// insert fragment pause
			if(i != a_fragments.length-1) {
				a_chunks.push(T_PAUSE_FRAGMENT);
			}
		}
	};


	// split paragraph by sentences
	var split_paragraph = function(s_paragraph) {

		// separate by punctuation
		var a_sentences = s_paragraph.split(X_SENTENCES);

		// iterate sentences
		for(var i=0; i<a_sentences.length; i++) {

			// break down sentence
			split_sentence(a_sentences[i]);

			// insert pause after each sentence
			if(i != a_sentences.length-1) a_chunks.push(T_PAUSE_SENTENCE);
		}
	};


	// split paper by paragraphs
	var split_paper = function(s_paper) {

		// separate by special delimeter
		var a_paragraphs = s_paper.split(X_PARAGRAPHS);

		// iterate paragraphs
		for(var i=0; i<a_paragraphs.length; i++) {

			// insert sound before each new paragraph
			if(i != 0) a_chunks.push(H_TONE_PARAGRAPH);

			// break down paragraph
			split_paragraph(a_paragraphs[i]);
		}
	};


	// public operator
	var operator = function(p_pdf) {

		// convert pdf to text
		pdf_to_text(p_pdf, function(s_pdf) {

			// filter out crap we don't care about
			var s_text = filter_paper(s_pdf);

			// experimental sentence splitting
			split_paper(s_text);

			console.log('\n\n\n\n');
			console.log(a_chunks.slice(0, 130));

			// process all the text into audio
			process_text();
		});

	};

	// 
	return operator;

})();

pdf_ts('../test/Core concepts of spatial information for transdisciplinary research.pdf');