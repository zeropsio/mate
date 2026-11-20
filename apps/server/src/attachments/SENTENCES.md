next: AT19

- AT1 — An attachment id made for a thread carries the thread as one segment of letters, digits, `_` and `-` only, which the id reads back
- AT2 — A thread named `pending` gets the segment `_pending`, so no thread's attachment reads as a pending upload
- AT3 — A stored file keeps its extension in lowercase, and a missing, over-long or `.part` extension (an upload in flight) is stored as `.bin`
- AT4 — An attachment looked up by id resolves to the file of that id that exists on disk, whatever its extension, and to nothing when none exists
- AT5 — A message claims only a pending upload: an id a thread already holds is refused even when the claiming thread's name reduces to the same segment, and a claimed upload gets a fresh id in the claiming thread, its file extension kept
- AT6 — The pending sweep removes expired pending uploads and partial upload files, never an attachment a thread holds
- AT7 — Claude gets each picture right after its label, the words between as text, while a slash command, words after the last picture that start with a slash, a message ending on a picture, a skill's leading words and a message placing no picture keep the content as it was
- AT8 — The pictures Claude was sent are named by their label where the text places them and by their file name where it does not, and a picture's kept original is none of them
- AT9 — When Claude could not read a picture, the person is pointed at the first picture over 2000 px a side or 3.8 MB by its label or file name, and at no picture when none is over
- AT10 — The line telling the agent where a file is saved stays one whole line whatever the file's name or note holds (quotes, brackets, line breaks, bidirectional overrides and isolates, tag characters), and reads back the name, path and note as sent
- AT11 — A picture's kept original never reaches a provider as one of the model's files, while every other attachment does
- AT12 — A sent file's name in the uploads folder drops every folder, control character, bidirectional mark, separator, tag character and bracket, and a name of dots only or nothing becomes `file`
- AT13 — A long name is cut to 255 bytes between characters, its extension and any number kept, and another file of one name is numbered before its extension
- AT14 — A sent file lands in the uploads folder under its own name as the agent's own copy: the agent editing it in place leaves the stored attachment as sent
- AT15 — The same file sent again finds its kept copy while that copy stands as it was made, and a copy the agent changed or replaced, or another file of the same name, gets the next numbered name, the first left alone
- AT16 — A picture and folded clipboard text stay where they are stored, and no uploads folder is made for them
- AT17 — A file the uploads folder cannot take is pointed at where it is stored, with a reason for the agent
- AT18 — The partial-copy sweep removes the hidden halves of copies an hour old or more, keeping younger ones and every kept file, and finds nothing without a folder
