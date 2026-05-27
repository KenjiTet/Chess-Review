from analysis import analyze_game, find_blunders, get_board_snapshots

pgn = open('test.pgn').read()
move_data = analyze_game(pgn)
blunders = find_blunders(move_data)
fens, moves = get_board_snapshots(pgn)

print(f'Total moves: {len(move_data)}')
print(f'Blunders found: {len(blunders)}')
print(f'FEN snapshots: {len(fens)}')
print('First blunder:', blunders[0] if blunders else 'none')
