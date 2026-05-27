from api import get_recent_games
games = get_recent_games('OrangeMutante', 'rapid', 3)
print(f'Fetched {len(games)} games')
print('First game URL:', games[0]['url'])
